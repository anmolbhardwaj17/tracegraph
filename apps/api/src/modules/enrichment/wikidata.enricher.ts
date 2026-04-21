import { Logger } from '@nestjs/common';
import axios from 'axios';
import {
  Enricher, EnrichedCompanyData, EnrichedPerson,
  EnrichedSubsidiary, EnrichedLocation, EnrichedOwner,
} from './enrichment.interface';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence; contact@tracegraph.com)';

let lastReq = 0;
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 2000 - (Date.now() - lastReq)); // Wikidata wants ≤1 req/sec
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

/**
 * Wikidata SPARQL enricher — pulls structured company data from the world's largest
 * open knowledge graph. Works for companies in any jurisdiction.
 *
 * Data sourced: HQ location, key people (CEO, board, founders), subsidiaries,
 * parent org, industry, revenue, employee count, website, founding date.
 */
export class WikidataEnricher implements Enricher {
  readonly name = 'wikidata';
  readonly supportedJurisdictions: string[] = []; // all jurisdictions
  private readonly logger = new Logger(WikidataEnricher.name);

  async enrich(companyName: string, _companyId: string, _jurisdiction: string): Promise<Partial<EnrichedCompanyData>> {
    const result: Partial<EnrichedCompanyData> = { source: 'wikidata' };

    try {
      // Step 1: Find the Wikidata entity for this company
      // Normalize SEC-style names: "AMAZON COM INC" → "Amazon.com" / "Amazon"
      const normalizedName = this.normalizeCompanyName(companyName);
      this.logger.log(`Wikidata: searching for "${normalizedName}" (original: "${companyName}")`);
      const entityId = await this.findEntity(normalizedName);
      if (!entityId) {
        this.logger.log(`Wikidata: no entity found for "${normalizedName}"`);
        return result;
      }
      this.logger.log(`Wikidata: found ${entityId} for "${normalizedName}"`);

      // Step 2: Fetch all enrichment data in one big SPARQL query
      const data = await this.fetchCompanyData(entityId);
      Object.assign(result, data);

      // Step 3: Get subsidiaries separately (can be large)
      const subs = await this.fetchSubsidiaries(entityId);
      if (subs.length > 0) result.subsidiaries = subs;

      // Step 4: Get key people
      const people = await this.fetchPeople(entityId);
      if (people.length > 0) result.people = people;

      this.logger.log(
        `Wikidata enrichment for "${companyName}": ` +
        `${result.locations?.length || 0} locations, ${result.people?.length || 0} people, ` +
        `${result.subsidiaries?.length || 0} subsidiaries`,
      );
    } catch (e: any) {
      this.logger.warn(`Wikidata enrichment failed for "${companyName}": ${e?.message}`);
    }

    return result;
  }

  /**
   * Normalize SEC-style uppercase names for Wikidata search.
   * "AMAZON COM INC" → "Amazon.com"
   * "APPLE INC" → "Apple"
   * "ALPHABET INC" → "Alphabet"
   * "JPMORGAN CHASE & CO" → "JPMorgan Chase"
   */
  private normalizeCompanyName(name: string): string {
    let n = name.trim();

    // Known mappings for SEC → common names (these are weird edge cases)
    const known: Record<string, string> = {
      'AMAZON COM INC': 'Amazon.com',
      'ALPHABET INC': 'Alphabet Inc.',
      'META PLATFORMS INC': 'Meta Platforms',
      'MICROSOFT CORP': 'Microsoft',
      'BERKSHIRE HATHAWAY INC': 'Berkshire Hathaway',
    };
    if (known[n.toUpperCase()]) return known[n.toUpperCase()];

    // Strip common suffixes
    n = n.replace(/\s*[,.]?\s*(INC\.?|CORP\.?|CO\.?|LTD\.?|PLC\.?|LLC\.?|LP\.?|NV\.?|SA\.?|AG\.?|GMBH|GROUP|HOLDINGS?\s*INC\.?|INTERNATIONAL)$/i, '').trim();
    // Remove trailing punctuation
    n = n.replace(/[,.\-]+$/, '').trim();

    // Title case: "APPLE" → "Apple", "JPMORGAN CHASE" → "Jpmorgan Chase"
    if (n === n.toUpperCase() && n.length > 3) {
      n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      // Fix common casing: "Jpmorgan" → "JPMorgan"
      n = n.replace(/\bJpmorgan\b/i, 'JPMorgan')
           .replace(/\bMcdonalds\b/i, "McDonald's")
           .replace(/\bCoca Cola\b/i, 'Coca-Cola');
    }

    return n;
  }

  /** Search Wikidata for a company entity by name */
  private async findEntity(companyName: string): Promise<string | null> {
    return cached(`wd:find:${companyName.toLowerCase()}`, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get('https://www.wikidata.org/w/api.php', {
            params: {
              action: 'wbsearchentities',
              search: companyName,
              language: 'en',
              type: 'item',
              limit: 5,
              format: 'json',
            },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
          }),
        );

        const results = res.data?.search || [];
        // Look for an entity that's a company/org (has description mentioning company, corporation, etc.)
        for (const r of results) {
          const desc = (r.description || '').toLowerCase();
          const label = (r.label || '').toLowerCase();
          const target = companyName.toLowerCase().replace(/[,.\s]+(inc|ltd|plc|corp|co|llc|gmbh|sa|ag|nv|bv)\.?$/i, '').trim();
          if (
            label.includes(target) ||
            target.includes(label)
          ) {
            // Verify it's a company-like entity
            if (
              desc.includes('company') || desc.includes('corporation') ||
              desc.includes('conglomerate') || desc.includes('enterprise') ||
              desc.includes('business') || desc.includes('bank') ||
              desc.includes('technology') || desc.includes('retailer') ||
              desc.includes('manufacturer') || desc.includes('provider') ||
              desc.includes('firm') || desc.includes('multinational') ||
              desc.includes('subsidiary') || desc.includes('group') ||
              desc.includes('inc.') || desc.includes('ltd') ||
              desc === '' // empty description — check anyway
            ) {
              return r.id;
            }
          }
        }
        // Fallback: just use first result if description looks corporate
        if (results.length > 0) {
          const desc = (results[0].description || '').toLowerCase();
          if (desc.includes('company') || desc.includes('corporation') || desc.includes('multinational') || desc.includes('conglomerate')) {
            return results[0].id;
          }
        }
        return null;
      } catch (e: any) {
        this.logger.warn(`Wikidata search failed: ${e?.message}`);
        return null;
      }
    });
  }

  /** Fetch core company data via SPARQL */
  private async fetchCompanyData(entityId: string): Promise<Partial<EnrichedCompanyData>> {
    return cached(`wd:data:${entityId}`, async () => {
      const query = `
        SELECT ?hqLabel ?hqCountryLabel ?hqCoord
               ?parentLabel ?parentCountryLabel
               ?industryLabel ?revenue ?revenueUnit
               ?website ?founded ?employees
               ?countryLabel
        WHERE {
          OPTIONAL { wd:${entityId} wdt:P159 ?hq . ?hq rdfs:label ?hqLabel . FILTER(LANG(?hqLabel) = "en")
                     OPTIONAL { ?hq wdt:P17 ?hqCountry . ?hqCountry rdfs:label ?hqCountryLabel . FILTER(LANG(?hqCountryLabel) = "en") }
                     OPTIONAL { ?hq wdt:P625 ?hqCoord . } }
          OPTIONAL { wd:${entityId} wdt:P749 ?parent . ?parent rdfs:label ?parentLabel . FILTER(LANG(?parentLabel) = "en")
                     OPTIONAL { ?parent wdt:P17 ?parentCountry . ?parentCountry rdfs:label ?parentCountryLabel . FILTER(LANG(?parentCountryLabel) = "en") } }
          OPTIONAL { wd:${entityId} wdt:P452 ?industry . ?industry rdfs:label ?industryLabel . FILTER(LANG(?industryLabel) = "en") }
          OPTIONAL { wd:${entityId} wdt:P2139 ?revenue . }
          OPTIONAL { wd:${entityId} wdt:P856 ?website . }
          OPTIONAL { wd:${entityId} wdt:P571 ?founded . }
          OPTIONAL { wd:${entityId} wdt:P1128 ?employees . }
          OPTIONAL { wd:${entityId} wdt:P17 ?country . ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
        }
        LIMIT 1
      `;

      const res = await this.sparql(query);
      const row = res[0];
      if (!row) return {};

      const result: Partial<EnrichedCompanyData> = {};

      // HQ location
      if (row.hqLabel?.value) {
        const loc: EnrichedLocation = {
          label: row.hqLabel.value,
          address: row.hqLabel.value + (row.hqCountryLabel?.value ? `, ${row.hqCountryLabel.value}` : ''),
          type: 'headquarters',
          country: row.hqCountryLabel?.value || null,
        };
        if (row.hqCoord?.value) {
          const match = row.hqCoord.value.match(/Point\(([^ ]+) ([^ ]+)\)/);
          if (match) {
            loc.lng = parseFloat(match[1]);
            loc.lat = parseFloat(match[2]);
          }
        }
        result.locations = [loc];
      }

      // Parent org
      if (row.parentLabel?.value) {
        result.parentChain = [{
          name: row.parentLabel.value,
          jurisdiction: row.parentCountryLabel?.value || null,
          relationship: 'parent organization',
          level: 1,
          source: 'wikidata',
        }];
      }

      if (row.industryLabel?.value) result.industry = row.industryLabel.value;
      if (row.revenue?.value) {
        const rev = parseFloat(row.revenue.value);
        if (rev > 1e9) result.revenue = `$${(rev / 1e9).toFixed(1)}B`;
        else if (rev > 1e6) result.revenue = `$${(rev / 1e6).toFixed(0)}M`;
        else result.revenue = `$${rev.toLocaleString()}`;
      }
      if (row.website?.value) result.website = row.website.value;
      if (row.founded?.value) result.foundedDate = row.founded.value.split('T')[0];
      if (row.employees?.value) result.employeeCount = parseInt(row.employees.value, 10).toLocaleString();

      return result;
    });
  }

  /** Fetch subsidiaries via SPARQL */
  private async fetchSubsidiaries(entityId: string): Promise<EnrichedSubsidiary[]> {
    return cached(`wd:subs:${entityId}`, async () => {
      const query = `
        SELECT ?subLabel ?subCountryLabel ?subIndustryLabel WHERE {
          ?sub wdt:P749 wd:${entityId} .
          ?sub rdfs:label ?subLabel . FILTER(LANG(?subLabel) = "en")
          OPTIONAL { ?sub wdt:P17 ?subCountry . ?subCountry rdfs:label ?subCountryLabel . FILTER(LANG(?subCountryLabel) = "en") }
          OPTIONAL { ?sub wdt:P452 ?subIndustry . ?subIndustry rdfs:label ?subIndustryLabel . FILTER(LANG(?subIndustryLabel) = "en") }
        }
        LIMIT 100
      `;

      const rows = await this.sparql(query);
      return rows.map((r: any) => ({
        name: r.subLabel?.value || 'Unknown',
        jurisdiction: r.subCountryLabel?.value || null,
        ownershipPct: null,
        status: null,
        source: 'wikidata',
      }));
    });
  }

  /** Fetch key people (CEO, board, founders) via individual SPARQL queries */
  private async fetchPeople(entityId: string): Promise<EnrichedPerson[]> {
    return cached(`wd:people:${entityId}`, async () => {
      const seen = new Set<string>();
      const people: EnrichedPerson[] = [];

      // Run separate simple queries per role — avoids UNION timeout
      const roles: Array<{ prop: string; role: string; type: EnrichedPerson['type'] }> = [
        { prop: 'P169', role: 'CEO', type: 'executive' },
        { prop: 'P112', role: 'Founder', type: 'founder' },
        { prop: 'P488', role: 'Chairperson', type: 'board' },
        { prop: 'P3320', role: 'Board Member', type: 'board' },
        { prop: 'P1037', role: 'Director', type: 'board' },
        { prop: 'P1789', role: 'COO', type: 'executive' },
      ];

      for (const { prop, role, type } of roles) {
        try {
          const query = `
            SELECT ?personLabel WHERE {
              wd:${entityId} wdt:${prop} ?person .
              ?person rdfs:label ?personLabel . FILTER(LANG(?personLabel) = "en")
            } LIMIT 20
          `;
          const rows = await this.sparql(query);
          for (const r of rows) {
            const name = r.personLabel?.value;
            if (!name || seen.has(name)) continue;
            seen.add(name);
            people.push({ name, role, type, source: 'wikidata' });
          }
        } catch { /* skip this role */ }
      }

      return people;
    });
  }

  private async sparql(query: string): Promise<any[]> {
    try {
      const res = await rateLimited(() =>
        axios.get(WIKIDATA_SPARQL, {
          params: { query, format: 'json' },
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
          timeout: 30000,
        }),
      );
      return res.data?.results?.bindings || [];
    } catch (e: any) {
      this.logger.warn(`SPARQL query failed: ${e?.message}`);
      return [];
    }
  }
}
