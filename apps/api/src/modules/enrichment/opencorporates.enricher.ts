import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  Enricher, EnrichedCompanyData, EnrichedPerson,
  EnrichedLocation, EnrichedSubsidiary,
} from './enrichment.interface';

const BASE = 'https://api.opencorporates.com/v0.4';
const RATE_LIMIT_DELAY = 250;

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, RATE_LIMIT_DELAY - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

/**
 * OpenCorporates Enricher — pulls officers, addresses, and corporate groupings
 * from the world's largest open company database. Works for 140+ jurisdictions.
 *
 * This is the fallback enricher for non-UK, non-US jurisdictions (EU, India, etc.)
 * but also supplements US/UK data with cross-references.
 */
export class OpenCorporatesEnricher implements Enricher {
  readonly name = 'opencorporates';
  readonly supportedJurisdictions: string[] = []; // all jurisdictions
  private readonly logger = new Logger(OpenCorporatesEnricher.name);

  async enrich(companyName: string, _companyId: string, jurisdiction: string): Promise<Partial<EnrichedCompanyData>> {
    const result: Partial<EnrichedCompanyData> = { source: 'opencorporates' };

    try {
      // Skip entirely if no API key — OpenCorporates requires one for reliable access
      if (!process.env.OPENCORPORATES_API_KEY) {
        this.logger.log(`OpenCorporates: skipped (no OPENCORPORATES_API_KEY set)`);
        return result;
      }

      // Normalize SEC-style names: "AMAZON COM INC" → "Amazon"
      const searchName = this.normalizeCompanyName(companyName);
      this.logger.log(`OpenCorporates: searching for "${searchName}" (original: "${companyName}")`);

      // Step 1: Search for the company to get the OC jurisdiction_code + company_number
      const company = await this.findCompany(searchName, jurisdiction);
      if (!company) {
        this.logger.log(`OpenCorporates: no match for "${searchName}" in ${jurisdiction}`);
        return result;
      }

      const jCode = company.jurisdiction_code;
      const cNum = company.company_number;
      this.logger.log(`OpenCorporates: found ${jCode}/${cNum} for "${companyName}"`);

      // Step 2: Get full profile + officers + corporate grouping in parallel
      const [profile, officers, grouping] = await Promise.all([
        this.getProfile(jCode, cNum),
        this.getOfficers(jCode, cNum),
        this.getCorporateGrouping(jCode, cNum),
      ]);

      // Locations from registered address
      if (profile?.registeredAddress) {
        result.locations = [{
          label: 'Registered Address',
          address: profile.registeredAddress,
          type: 'registered',
          country: profile.country || null,
        }];
      }
      if (profile?.industry) result.industry = profile.industry;
      if (profile?.foundedDate) result.foundedDate = profile.foundedDate;
      if (profile?.website) result.website = profile.website;

      // Officers → people
      if (officers.length > 0) {
        result.people = officers;
      }

      // Corporate grouping → subsidiaries + parents
      if (grouping.subsidiaries.length > 0) {
        result.subsidiaries = grouping.subsidiaries;
      }
      if (grouping.parents.length > 0) {
        result.parentChain = grouping.parents.map((p, i) => ({
          name: p.name,
          jurisdiction: p.jurisdiction,
          relationship: i === 0 ? 'controlling company' : 'ultimate parent',
          level: i + 1,
          source: 'opencorporates',
        }));
      }

      this.logger.log(
        `OpenCorporates enrichment for "${companyName}": ` +
        `${result.locations?.length || 0} locations, ${officers.length} officers, ` +
        `${grouping.subsidiaries.length} subsidiaries`,
      );
    } catch (e: any) {
      this.logger.warn(`OpenCorporates enrichment failed for "${companyName}": ${e?.message}`);
    }

    return result;
  }

  /** Normalize SEC-style names for search */
  private normalizeCompanyName(name: string): string {
    let n = name.trim();
    // Known mappings
    const known: Record<string, string> = {
      'AMAZON COM INC': 'Amazon.com Inc',
      'ALPHABET INC': 'Alphabet Inc',
      'META PLATFORMS INC': 'Meta Platforms Inc',
    };
    if (known[n.toUpperCase()]) return known[n.toUpperCase()];

    // Strip common suffixes but keep enough for search
    n = n.replace(/\s*[,.]?\s*(INC\.?|CORP\.?|CO\.?|LTD\.?|PLC\.?|LLC\.?|LP\.?)$/i, '').trim();
    n = n.replace(/[,.\-]+$/, '').trim();

    // Title case if all-caps
    if (n === n.toUpperCase() && n.length > 3) {
      n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return n;
  }

  private apiParams(): Record<string, string> {
    const params: Record<string, string> = {};
    const apiKey = process.env.OPENCORPORATES_API_KEY;
    if (apiKey) params.api_token = apiKey;
    return params;
  }

  /** Search for a company by name, return best match */
  private async findCompany(name: string, jurisdiction: string): Promise<{ jurisdiction_code: string; company_number: string } | null> {
    return cached(`oc-enrich:find:${name}:${jurisdiction}`, async () => {
      try {
        const jMap: Record<string, string> = {
          us: 'us', gb: 'gb', de: 'de', fr: 'fr', in: 'in',
          ca: 'ca', au: 'au', ie: 'ie', nl: 'nl', sg: 'sg',
          hk: 'hk', jp: 'jp', cn: 'cn', kr: 'kr', br: 'br',
        };
        const params: any = { q: name, per_page: 5, ...this.apiParams() };
        if (jMap[jurisdiction]) params.jurisdiction_code = jMap[jurisdiction];

        const res = await rl(() =>
          axios.get(`${BASE}/companies/search`, { params, timeout: 10000 }),
        );

        const companies = res.data?.results?.companies || [];
        if (companies.length === 0) return null;

        // Best match: exact name or closest
        const target = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        let best = companies[0].company;
        for (const c of companies) {
          const co = c.company;
          const coName = (co.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (coName === target || coName.includes(target) || target.includes(coName)) {
            best = co;
            break;
          }
        }

        return { jurisdiction_code: best.jurisdiction_code, company_number: best.company_number };
      } catch {
        return null;
      }
    });
  }

  /** Get detailed profile */
  private async getProfile(jCode: string, cNum: string): Promise<{ registeredAddress: string | null; country: string | null; industry: string | null; foundedDate: string | null; website: string | null } | null> {
    return cached(`oc-enrich:profile:${jCode}:${cNum}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`${BASE}/companies/${jCode}/${cNum}`, { params: this.apiParams(), timeout: 10000 }),
        );
        const co = res.data?.results?.company;
        if (!co) return null;

        const addr = co.registered_address;
        const addressStr = addr
          ? [addr.street_address, addr.locality, addr.region, addr.postal_code, addr.country].filter(Boolean).join(', ')
          : null;

        const industry = co.industry_codes?.map((ic: any) => ic.industry_code?.description).filter(Boolean).join(', ') || null;

        return {
          registeredAddress: addressStr,
          country: addr?.country || co.jurisdiction_code?.toUpperCase() || null,
          industry,
          foundedDate: co.incorporation_date || null,
          website: null, // OC doesn't provide website
        };
      } catch {
        return null;
      }
    });
  }

  /** Get officers as enriched people */
  private async getOfficers(jCode: string, cNum: string): Promise<EnrichedPerson[]> {
    return cached(`oc-enrich:officers:${jCode}:${cNum}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`${BASE}/companies/${jCode}/${cNum}/officers`, { params: this.apiParams(), timeout: 10000 }),
        );

        const officers = res.data?.results?.officers || [];
        return officers.slice(0, 50).map((o: any) => {
          const off = o.officer;
          const role = (off.position || 'director').toLowerCase();
          let type: EnrichedPerson['type'] = 'officer';
          if (role.includes('director') || role.includes('board') || role.includes('chairman')) type = 'board';
          else if (role.includes('chief') || role.includes('president') || role.includes('ceo') || role.includes('cfo')) type = 'executive';

          return {
            name: off.name,
            role: off.position || 'Director',
            type,
            source: 'opencorporates',
          };
        });
      } catch {
        return [];
      }
    });
  }

  /** Get corporate grouping (parent + subsidiaries) */
  private async getCorporateGrouping(jCode: string, cNum: string): Promise<{ parents: Array<{ name: string; jurisdiction: string }>; subsidiaries: EnrichedSubsidiary[] }> {
    return cached(`oc-enrich:group:${jCode}:${cNum}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`${BASE}/companies/${jCode}/${cNum}/corporate_groupings`, { params: this.apiParams(), timeout: 10000 }),
        );

        const groupings = res.data?.results?.corporate_groupings || [];
        if (groupings.length === 0) return { parents: [], subsidiaries: [] };

        // Get the first grouping's members
        const groupName = groupings[0]?.corporate_grouping?.name;
        if (!groupName) return { parents: [], subsidiaries: [] };

        const membersRes = await rl(() =>
          axios.get(`${BASE}/corporate_groupings/${encodeURIComponent(groupName)}/memberships`, {
            params: { ...this.apiParams(), per_page: 50 },
            timeout: 10000,
          }),
        );

        const memberships = membersRes.data?.results?.memberships || [];
        const subsidiaries: EnrichedSubsidiary[] = [];
        const parents: Array<{ name: string; jurisdiction: string }> = [];

        for (const m of memberships) {
          const mem = m.membership;
          const co = mem?.company;
          if (!co) continue;

          // If this company IS the target, skip
          if (co.company_number === cNum && co.jurisdiction_code === jCode) continue;

          subsidiaries.push({
            name: co.name || 'Unknown',
            jurisdiction: co.jurisdiction_code?.toUpperCase() || null,
            ownershipPct: null,
            status: co.current_status || null,
            source: 'opencorporates',
          });
        }

        return { parents, subsidiaries: subsidiaries.slice(0, 100) };
      } catch {
        return { parents: [], subsidiaries: [] };
      }
    });
  }
}
