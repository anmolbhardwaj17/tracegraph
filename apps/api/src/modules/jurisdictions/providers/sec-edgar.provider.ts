import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer,
  DataSource, DataDepth,
} from '../data-provider.interface';

const SEARCH_BASE = 'https://efts.sec.gov/LATEST';
const DATA_BASE = 'https://data.sec.gov';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';
const RATE_LIMIT_DELAY = 110; // SEC allows 10 req/sec

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((data) => { cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL }); return data; });
}

let lastRequest = 0;
async function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, RATE_LIMIT_DELAY - (now - lastRequest));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  return fn();
}

function padCik(cik: string): string {
  return cik.replace(/^0+/, '').padStart(10, '0');
}

@Injectable()
export class SecEdgarProvider implements CompanyDataProvider {
  private readonly logger = new Logger(SecEdgarProvider.name);
  readonly source: DataSource = 'sec-edgar';
  readonly dataDepth: DataDepth = 'moderate';

  private readonly headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    const cacheKey = `sec:search:${query}`;
    return cached(cacheKey, async () => {
      try {
        // Use the EDGAR full-text search
        const res = await rateLimited(() =>
          axios.get(`${SEARCH_BASE}/search-index`, {
            params: { q: query, dateRange: 'custom', startdt: '2015-01-01' },
            headers: this.headers,
            timeout: 10000,
          }),
        );

        // Also try the company tickers endpoint for exact matches
        const tickerRes = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${padCik('0')}.json`, {
            headers: this.headers,
            timeout: 5000,
          }).catch(() => null),
        );

        // Parse search results — EDGAR search returns filing hits, extract unique companies
        const hits = res.data?.hits?.hits || [];
        const seen = new Set<string>();
        const results: CompanySearchResult[] = [];

        for (const hit of hits.slice(0, 50)) {
          const src = hit._source || {};
          const displayName = src.display_names?.[0] || src.entity_name || '';
          if (!displayName) continue;

          // Extract CIK from display name: "AMAZON COM INC  (AMZN)  (CIK 0001018724)"
          const cikMatch = displayName.match(/CIK\s+(\d+)/);
          const cik = cikMatch ? cikMatch[1] : src.entity_id || '';
          if (!cik || seen.has(cik)) continue;
          seen.add(cik);

          // Clean name: remove (CIK ...) and (TICKER) parts
          const cleanName = displayName
            .replace(/\s*\(CIK\s+\d+\)/g, '')
            .replace(/\s*\([A-Z]{1,5}\)/g, '')
            .trim();

          results.push({
            name: cleanName || displayName,
            companyNumber: cik,
            jurisdiction: 'us',
            status: 'active',
            incorporationDate: null,
            registryUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`,
            source: 'sec-edgar',
          });
        }

        return results.slice(0, 20);
      } catch (e: any) {
        this.logger.warn(`SEC search failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyProfile(cik: string): Promise<CompanyProfile | null> {
    const paddedCik = padCik(cik);
    const cacheKey = `sec:profile:${paddedCik}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${paddedCik}.json`, {
            headers: this.headers,
            timeout: 10000,
          }),
        );

        const data = res.data;
        if (!data) return null;

        const addr = data.addresses?.mailing || data.addresses?.business || {};
        const addressStr = [addr.street1, addr.street2, addr.city, addr.stateOrCountry, addr.zipCode]
          .filter(Boolean).join(', ');

        return {
          name: data.name || data.entityType || cik,
          companyNumber: cik,
          jurisdiction: 'us',
          jurisdictionLabel: 'United States',
          status: data.tickers?.length > 0 ? 'active' : 'unknown',
          incorporationDate: data.stateOfIncorporation ? null : null, // SEC doesn't provide inc date directly
          dissolutionDate: null,
          companyType: data.entityType || null,
          registeredAddress: addressStr || null,
          sicCodes: data.sic ? [data.sic] : [],
          registryUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}`,
          source: 'sec-edgar',
          dataDepth: 'moderate',
        } as CompanyProfile;
      } catch (e: any) {
        this.logger.warn(`SEC profile failed for CIK ${cik}: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(cik: string): Promise<Officer[]> {
    const paddedCik = padCik(cik);
    const cacheKey = `sec:officers:${paddedCik}`;
    return cached(cacheKey, async () => {
      try {
        // Officers come from the submissions data (recent filings list)
        const res = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${paddedCik}.json`, {
            headers: this.headers,
            timeout: 10000,
          }),
        );

        const data = res.data;
        const officers: Officer[] = [];

        // Parse from formerNames and officer/director data if available
        // SEC doesn't have a direct officers endpoint — we extract from filings metadata
        // The submissions endpoint includes form types; 10-K and DEF 14A contain officer info
        // For now, extract what we can from the company data structure

        if (data.officers) {
          for (const off of data.officers) {
            officers.push({
              name: off.name || off.officerName || 'Unknown',
              role: off.title || off.position || 'officer',
              appointedDate: null,
              resignedDate: null,
              nationality: null,
              dateOfBirth: null,
              source: 'sec-edgar',
            });
          }
        }

        // Also check insiders if available
        if (data.insiders) {
          for (const ins of data.insiders.slice(0, 20)) {
            if (!officers.find((o) => o.name.toLowerCase() === (ins.name || '').toLowerCase())) {
              officers.push({
                name: ins.name || 'Unknown',
                role: ins.relationship || 'insider',
                appointedDate: null,
                resignedDate: null,
                nationality: null,
                dateOfBirth: null,
                source: 'sec-edgar',
              });
            }
          }
        }

        return officers;
      } catch (e: any) {
        this.logger.warn(`SEC officers failed for CIK ${cik}: ${e?.message}`);
        return [];
      }
    });
  }
}
