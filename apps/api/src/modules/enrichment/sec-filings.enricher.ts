import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  Enricher, EnrichedCompanyData, EnrichedPerson,
  EnrichedSubsidiary, EnrichedLocation,
} from './enrichment.interface';

const DATA_BASE = 'https://data.sec.gov';
const SEC_BASE = 'https://www.sec.gov';
const EFTS_BASE = 'https://efts.sec.gov/LATEST';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 120 - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

function padCik(cik: string | number): string {
  return String(cik).replace(/^0+/, '').padStart(10, '0');
}

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => {
    // Never cache empty arrays for subsidiary/executive results (may be rate-limit artifacts)
    if (Array.isArray(d) && d.length === 0 && (key.includes(':subs:') || key.includes(':execs:'))) return d;
    cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL });
    return d;
  });
}

/**
 * SEC Filings Enricher — deep scrape of SEC EDGAR filings:
 * 1. DEF 14A (proxy statements) → board of directors + executive officers
 * 2. 10-K (annual reports) → Exhibit 21 subsidiary list
 * 3. Company facts XBRL → structured financial data (revenue, assets, employees)
 * 4. Business address from submissions → registered/HQ location
 */
export class SecFilingsEnricher implements Enricher {
  readonly name = 'sec-filings';
  readonly supportedJurisdictions = ['us'];
  private readonly logger = new Logger(SecFilingsEnricher.name);

  async enrich(companyName: string, companyId: string, jurisdiction: string): Promise<Partial<EnrichedCompanyData>> {
    if (jurisdiction !== 'us') return {};
    const result: Partial<EnrichedCompanyData> = { source: 'sec-filings' };
    const cik = companyId.replace(/^0+/, '');

    try {
      // Run all enrichments in parallel
      const [subsidiaries, executives, locations, financials] = await Promise.all([
        this.getSubsidiariesFrom10K(cik).catch(() => [] as EnrichedSubsidiary[]),
        this.getExecutivesFromProxy(cik).catch(() => [] as EnrichedPerson[]),
        this.getLocations(cik).catch(() => [] as EnrichedLocation[]),
        this.getCompanyFacts(cik).catch(() => ({} as any)),
      ]);

      if (subsidiaries.length > 0) result.subsidiaries = subsidiaries;
      if (executives.length > 0) result.people = executives;
      if (locations.length > 0) result.locations = locations;
      if (financials.revenue) result.revenue = financials.revenue;
      if (financials.employees) result.employeeCount = financials.employees;

      this.logger.log(
        `SEC filings enrichment for "${companyName}": ` +
        `${subsidiaries.length} subsidiaries, ${executives.length} executives, ${locations.length} locations`,
      );
    } catch (e: any) {
      this.logger.warn(`SEC filings enrichment failed for "${companyName}": ${e?.message}`);
    }

    return result;
  }

  /**
   * Parse 10-K Exhibit 21 for subsidiary list.
   * Exhibit 21 is typically a text/HTML file listing all subsidiaries.
   */
  private async getSubsidiariesFrom10K(cik: string): Promise<EnrichedSubsidiary[]> {
    return cached(`sec-enrich:subs:${cik}`, async () => {
      // Find the most recent 10-K filing
      const subData = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, {
          headers: HEADERS, timeout: 10000,
        }),
      );
      const filings = subData.data?.filings?.recent || {};
      const forms = filings.form || [];
      const accessions = filings.accessionNumber || [];

      let tenKAccession: string | null = null;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === '10-K' || forms[i] === '10-K/A') {
          tenKAccession = accessions[i];
          break;
        }
      }
      if (!tenKAccession) return [];

      // Get the filing index to find Exhibit 21
      const accClean = tenKAccession.replace(/-/g, '');
      const idxRes = await rl(() =>
        axios.get(`${SEC_BASE}/Archives/edgar/data/${cik}/${accClean}/${tenKAccession}-index.htm`, {
          headers: HEADERS, timeout: 10000, responseType: 'text',
        }),
      );
      const idxHtml = idxRes.data as string;

      // Find Exhibit 21 link (subsidiaries)
      const ex21Match = idxHtml.match(/href="([^"]+)"[^>]*>[^<]*(?:EX-?21|Exhibit\s*21|SUBSIDIARIES)[^<]*/i)
        || idxHtml.match(/(?:EX-?21|exhibit21)[^"]*\.htm/i);

      if (!ex21Match) {
        // Try searching the filing documents for ex21
        const docMatch = idxHtml.match(/href="([^"]*ex21[^"]*)"/i)
          || idxHtml.match(/href="([^"]*exhibit21[^"]*)"/i)
          || idxHtml.match(/href="([^"]*subsidiaries[^"]*)"/i);
        if (!docMatch) return [];
        return this.parseExhibit21(cik, accClean, docMatch[1]);
      }

      return this.parseExhibit21(cik, accClean, ex21Match[1]);
    });
  }

  private async parseExhibit21(cik: string, accClean: string, docPath: string): Promise<EnrichedSubsidiary[]> {
    let url = docPath;
    if (!url.startsWith('http')) {
      url = `${SEC_BASE}/Archives/edgar/data/${cik}/${accClean}/${docPath}`;
    }

    const res = await rl(() =>
      axios.get(url, { headers: HEADERS, timeout: 15000, responseType: 'text' }),
    );

    const html = res.data as string;

    // Try table-based parsing first (most modern Exhibit 21s use HTML tables)
    const tableResults = this.parseExhibit21Table(html);
    if (tableResults.length > 0) return tableResults.slice(0, 200);

    // Fallback: line-based parsing for plain text / simple HTML
    return this.parseExhibit21Lines(html).slice(0, 200);
  }

  /** Parse Exhibit 21 from HTML tables — handles <tr><td>Name</td><td>Jurisdiction</td><td>%</td></tr> */
  private parseExhibit21Table(html: string): EnrichedSubsidiary[] {
    const subsidiaries: EnrichedSubsidiary[] = [];
    const seen = new Set<string>();

    // Extract all table rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      // Extract cell contents
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const cells: string[] = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        const text = cellMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&#\d+;/g, ' ')
          .trim();
        // Only keep non-empty cells (skip colspan spacers)
        if (text.length > 0) cells.push(text);
      }

      if (cells.length < 2) continue;
      const name = cells[0].trim();
      const jurisdiction = cells[1].trim();
      // Ownership % may be split across cells: "100" "%" — join them
      const pctRaw = cells.slice(2).join('').trim() || null;

      // Skip headers and empty rows
      if (!name || name.length < 3 || name.length > 200) continue;
      if (/^(legal\s*name|name|subsidiary|entity|jurisdiction|state|percent|document|exhibit)/i.test(name)) continue;
      if (/^\d+$/.test(name)) continue;

      // Validate it looks like a company name
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const ownershipPct = pctRaw ? pctRaw.replace(/[^\d.%]/g, '').trim() || null : null;

      subsidiaries.push({
        name,
        jurisdiction: jurisdiction && jurisdiction.length < 60 ? jurisdiction : null,
        ownershipPct: ownershipPct ? `${ownershipPct}%`.replace('%%', '%') : null,
        status: null,
        source: 'sec-10k-ex21',
      });
    }

    return subsidiaries;
  }

  /** Fallback: parse Exhibit 21 from stripped text lines (columnar layout) */
  private parseExhibit21Lines(html: string): EnrichedSubsidiary[] {
    const text = html
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#\d+;/g, ' ');

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const subsidiaries: EnrichedSubsidiary[] = [];
    const seen = new Set<string>();

    // Known US states/territories and common jurisdictions
    const jurisdictions = new Set([
      'delaware', 'california', 'new york', 'texas', 'nevada', 'florida',
      'washington', 'illinois', 'virginia', 'georgia', 'massachusetts',
      'new jersey', 'pennsylvania', 'ohio', 'colorado', 'maryland',
      'connecticut', 'arizona', 'oregon', 'michigan', 'minnesota',
      'north carolina', 'indiana', 'wisconsin', 'tennessee', 'missouri',
      'louisiana', 'kentucky', 'alabama', 'south carolina', 'utah',
      'oklahoma', 'iowa', 'arkansas', 'kansas', 'nebraska', 'mississippi',
      'hawaii', 'idaho', 'montana', 'wyoming', 'maine', 'rhode island',
      'new hampshire', 'vermont', 'alaska', 'south dakota', 'north dakota',
      'west virginia', 'new mexico', 'district of columbia',
      'united kingdom', 'germany', 'ireland', 'luxembourg', 'india',
      'japan', 'china', 'canada', 'australia', 'france', 'netherlands',
      'singapore', 'hong kong', 'brazil', 'israel', 'italy', 'spain',
      'sweden', 'switzerland', 'south korea', 'england', 'scotland',
      'cayman islands', 'bermuda', 'british virgin islands',
    ]);

    // Columnar format: lines alternate between Name, Jurisdiction, and sometimes Pct
    // Strategy: scan for lines that look like company names, followed by jurisdiction lines
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1]?.toLowerCase() || '';

      // Skip headers and short lines
      if (line.length < 4 || line.length > 200) continue;
      if (/^(legal\s*name|name|subsidiary|subsidiaries|exhibit|jurisdiction|state|page|document|list|percent|EX-)/i.test(line)) continue;
      if (/^\d+[\s%]*$/.test(line)) continue;

      // Check if this line looks like a company name and next line is a jurisdiction
      if (jurisdictions.has(nextLine.replace(/[^a-z ]/g, '').trim())) {
        const name = line;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const jurisdiction = lines[i + 1].trim();
        // Check if there's an ownership % after the jurisdiction
        const pctLine = lines[i + 2]?.trim() || '';
        const ownershipPct = /^\d+[\s%]*$/.test(pctLine) ? pctLine.replace(/[^\d]/g, '') + '%' : null;

        subsidiaries.push({
          name,
          jurisdiction,
          ownershipPct,
          status: null,
          source: 'sec-10k-ex21',
        });

        i += ownershipPct ? 2 : 1; // skip jurisdiction (and pct if found)
        continue;
      }

      // Inline format: "Name    Jurisdiction" on same line
      const tabSplit = line.split(/\t+|\s{3,}/);
      if (tabSplit.length >= 2 && tabSplit[0].length > 2) {
        const name = tabSplit[0].trim();
        const jurisdiction = tabSplit[tabSplit.length - 1].trim();
        if (!seen.has(name.toLowerCase()) && name.length < 200) {
          seen.add(name.toLowerCase());
          subsidiaries.push({
            name,
            jurisdiction: jurisdiction.length < 50 ? jurisdiction : null,
            ownershipPct: null,
            status: null,
            source: 'sec-10k-ex21',
          });
        }
      }
    }

    return subsidiaries;
  }

  /**
   * Parse DEF 14A proxy statement to extract board + executives.
   * Uses EFTS full-text search to find proxy filing content.
   */
  private async getExecutivesFromProxy(cik: string): Promise<EnrichedPerson[]> {
    return cached(`sec-enrich:execs:${cik}`, async () => {
      // Get latest DEF 14A filing
      const subData = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, {
          headers: HEADERS, timeout: 10000,
        }),
      );
      const filings = subData.data?.filings?.recent || {};
      const forms = filings.form || [];
      const accessions = filings.accessionNumber || [];
      const primaryDocs = filings.primaryDocument || [];

      let proxyAccession: string | null = null;
      let proxyDoc: string | null = null;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === 'DEF 14A' || forms[i] === 'DEFA14A') {
          proxyAccession = accessions[i];
          proxyDoc = primaryDocs[i];
          break;
        }
      }
      if (!proxyAccession || !proxyDoc) return [];

      const accClean = proxyAccession.replace(/-/g, '');
      const url = `${SEC_BASE}/Archives/edgar/data/${cik}/${accClean}/${proxyDoc}`;

      const res = await rl(() =>
        axios.get(url, { headers: HEADERS, timeout: 30000, responseType: 'text' }),
      );

      return this.parseProxyForExecutives(res.data as string);
    });
  }

  private parseProxyForExecutives(html: string): EnrichedPerson[] {
    const text = html
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&#\d+;/g, ' ');

    const people: EnrichedPerson[] = [];
    const seen = new Set<string>();

    // Look for common proxy patterns:
    // "DIRECTORS" section, "EXECUTIVE OFFICERS" section

    // Pattern 1: Named individuals with titles
    // e.g., "John Smith, Chief Executive Officer"
    // e.g., "Jane Doe    President and CEO"
    const titlePatterns = [
      /([A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s*[,\-–—]\s*((?:Chief|President|Vice|Executive|Senior|General|Global|Managing|Principal|Corporate|Head)\s[A-Za-z\s,&]+)/g,
      /([A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s*[,\-–—]\s*(CEO|CFO|COO|CTO|CIO|CLO|CMO|CHRO|Chairman|Chairwoman|Director)/g,
    ];

    for (const pattern of titlePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1].trim();
        const role = match[2].trim();
        if (name.length < 4 || name.length > 60) continue;
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());

        let type: EnrichedPerson['type'] = 'officer';
        const roleLower = role.toLowerCase();
        if (roleLower.includes('director') || roleLower.includes('chairman') || roleLower.includes('chairwoman') || roleLower.includes('board')) {
          type = 'board';
        } else if (roleLower.includes('chief') || roleLower.includes('president') || roleLower.includes('ceo') || roleLower.includes('cfo')) {
          type = 'executive';
        }

        people.push({ name, role, type, source: 'sec-def14a' });
      }
    }

    // Pattern 2: Look for "DIRECTORS" or "NOMINEES" sections with age patterns
    // e.g., "John Smith, age 55, has served as..."
    const agePattern = /([A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?)\s*[,.]?\s*(?:age|Age)\s*(\d{2})/g;
    let match;
    while ((match = agePattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length < 4 || name.length > 60) continue;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      people.push({ name, role: 'Director/Officer', type: 'board', source: 'sec-def14a' });
    }

    return people.slice(0, 50);
  }

  /** Get structured business/mailing addresses from SEC submissions */
  private async getLocations(cik: string): Promise<EnrichedLocation[]> {
    return cached(`sec-enrich:locs:${cik}`, async () => {
      const res = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, {
          headers: HEADERS, timeout: 10000,
        }),
      );

      const addresses = res.data?.addresses || {};
      const locations: EnrichedLocation[] = [];

      for (const [key, addr] of Object.entries(addresses) as [string, any][]) {
        if (!addr?.street1) continue;
        const parts = [addr.street1, addr.street2, addr.city, addr.stateOrCountry, addr.zipCode].filter(Boolean);
        locations.push({
          label: key === 'business' ? 'Business Address' : 'Mailing Address',
          address: parts.join(', '),
          type: key === 'business' ? 'headquarters' : 'registered',
          country: addr.stateOrCountryDescription || addr.stateOrCountry || null,
        });
      }

      return locations;
    });
  }

  /** Get structured financial data from XBRL company facts */
  private async getCompanyFacts(cik: string): Promise<{ revenue?: string; employees?: string }> {
    return cached(`sec-enrich:facts:${cik}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`${DATA_BASE}/api/xbrl/companyfacts/CIK${padCik(cik)}.json`, {
            headers: HEADERS, timeout: 15000,
          }),
        );

        const facts = res.data?.facts || {};
        const usGaap = facts['us-gaap'] || {};
        const result: { revenue?: string; employees?: string } = {};

        // Revenue
        const revFacts = usGaap['Revenues'] || usGaap['RevenueFromContractWithCustomerExcludingAssessedTax'] || usGaap['SalesRevenueNet'];
        if (revFacts?.units?.USD) {
          const usdValues = revFacts.units.USD.filter((v: any) => v.form === '10-K').sort((a: any, b: any) => b.end?.localeCompare(a.end));
          if (usdValues.length > 0) {
            const rev = usdValues[0].val;
            if (rev > 1e9) result.revenue = `$${(rev / 1e9).toFixed(1)}B`;
            else if (rev > 1e6) result.revenue = `$${(rev / 1e6).toFixed(0)}M`;
          }
        }

        // Employees
        const empFacts = usGaap['NumberOfEmployees'] || facts['dei']?.['EntityNumberOfEmployees'];
        if (empFacts?.units) {
          const unit = Object.values(empFacts.units)[0] as any[];
          if (unit) {
            const sorted = unit.filter((v: any) => v.form === '10-K').sort((a: any, b: any) => b.end?.localeCompare(a.end));
            if (sorted.length > 0) result.employees = parseInt(sorted[0].val, 10).toLocaleString();
          }
        }

        return result;
      } catch {
        return {};
      }
    });
  }
}
