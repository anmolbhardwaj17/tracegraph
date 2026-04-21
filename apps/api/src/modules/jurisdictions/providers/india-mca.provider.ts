import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer,
  DataSource, DataDepth,
} from '../data-provider.interface';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';
const RATE_LIMIT_DELAY = 300;

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, RATE_LIMIT_DELAY - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

/**
 * India MCA (Ministry of Corporate Affairs) Provider.
 *
 * Uses multiple sources for Indian company data:
 * 1. Tofler.in — free public search (no API key)
 * 2. Zaubacorp.com — free Indian company search
 * 3. Falls back to OpenCorporates for India (in jurisdiction code)
 *
 * MCA21 portal (mca.gov.in) requires CAPTCHA so we can't scrape it directly.
 */
@Injectable()
export class IndiaMcaProvider implements CompanyDataProvider {
  private readonly logger = new Logger(IndiaMcaProvider.name);
  readonly source: DataSource = 'opencorporates';
  readonly dataDepth: DataDepth = 'basic';

  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    return cached(`india:search:${query.toLowerCase()}`, async () => {
      const results: CompanySearchResult[] = [];

      // Source 1: Try Zaubacorp
      try {
        const res = await rl(() =>
          axios.get(`https://www.zaubacorp.com/custom-search`, {
            params: { search: query, filter: 'company' },
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
            timeout: 10000,
          }),
        );
        const items = res.data || [];
        if (Array.isArray(items)) {
          for (const item of items.slice(0, 10)) {
            results.push({
              name: item.title || item.name || query,
              companyNumber: item.cin || item.id || '',
              jurisdiction: 'in',
              status: (item.status || 'active').toLowerCase(),
              incorporationDate: item.date_of_incorporation || null,
              registryUrl: item.url || `https://www.zaubacorp.com/company/${item.cin || ''}`,
              source: 'opencorporates',
            });
          }
        }
      } catch (e: any) {
        this.logger.warn(`Zaubacorp search failed: ${e?.message}`);
      }

      // Source 2: Fallback to OpenCorporates India
      if (results.length === 0) {
        try {
          const params: any = { q: query, jurisdiction_code: 'in', per_page: 10 };
          const apiKey = process.env.OPENCORPORATES_API_KEY;
          if (apiKey) params.api_token = apiKey;

          const res = await rl(() =>
            axios.get('https://api.opencorporates.com/v0.4/companies/search', { params, timeout: 10000 }),
          );
          const companies = res.data?.results?.companies || [];
          for (const c of companies) {
            const co = c.company;
            results.push({
              name: co.name,
              companyNumber: co.company_number,
              jurisdiction: 'in',
              status: co.current_status || 'unknown',
              incorporationDate: co.incorporation_date || null,
              registryUrl: co.opencorporates_url || '',
              source: 'opencorporates',
            });
          }
        } catch (e: any) {
          this.logger.warn(`OpenCorporates India search failed: ${e?.message}`);
        }
      }

      return results;
    });
  }

  async getCompanyProfile(cin: string): Promise<CompanyProfile | null> {
    return cached(`india:profile:${cin}`, async () => {
      try {
        // Try Zaubacorp company page
        const res = await rl(() =>
          axios.get(`https://www.zaubacorp.com/company/${cin}`, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
            responseType: 'text',
          }),
        );

        const html = res.data as string;
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

        // Extract basic info from the page
        const nameMatch = html.match(/<h1[^>]*>([^<]+)</);
        const cinMatch = text.match(/CIN\s*:\s*([A-Z0-9]+)/i);
        const statusMatch = text.match(/Status\s*:\s*(Active|Dormant|Struck Off|Under Liquidation|Amalgamated)/i);
        const dateMatch = text.match(/Date of Incorporation\s*:\s*(\d{2}[-/]\d{2}[-/]\d{4})/);
        const typeMatch = text.match(/Company Type\s*:\s*([^.]+?)(?:\s*Category|\s*Sub)/i);
        const addressMatch = text.match(/Registered Address\s*:\s*([^.]{10,200})/i);

        const name = nameMatch?.[1]?.trim() || cin;
        return {
          name,
          companyNumber: cinMatch?.[1] || cin,
          jurisdiction: 'in',
          jurisdictionLabel: 'India',
          status: statusMatch?.[1]?.toLowerCase() === 'active' ? 'active' : 'unknown',
          incorporationDate: dateMatch?.[1] || null,
          dissolutionDate: null,
          companyType: typeMatch?.[1]?.trim() || null,
          registeredAddress: addressMatch?.[1]?.trim() || null,
          sicCodes: [],
          registryUrl: `https://www.zaubacorp.com/company/${cin}`,
          source: 'opencorporates',
          dataDepth: 'basic',
        } as CompanyProfile;
      } catch (e: any) {
        this.logger.warn(`India company profile failed for ${cin}: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(cin: string): Promise<Officer[]> {
    return cached(`india:officers:${cin}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`https://www.zaubacorp.com/company/${cin}`, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
            responseType: 'text',
          }),
        );

        const html = res.data as string;
        const officers: Officer[] = [];

        // Parse director table
        const directorPattern = /DIN\s*:\s*(\d+)[^<]*<[^>]*>([^<]+)<.*?(?:Designation\s*:\s*([^<]+))?/gi;
        let match;
        while ((match = directorPattern.exec(html)) !== null) {
          officers.push({
            name: match[2]?.trim() || 'Unknown',
            role: match[3]?.trim() || 'Director',
            appointedDate: null,
            resignedDate: null,
            nationality: 'Indian',
            dateOfBirth: null,
            source: 'opencorporates',
          });
        }

        // Fallback: look for names in director section
        if (officers.length === 0) {
          const dirSection = html.match(/Directors?.*?<\/table>/is);
          if (dirSection) {
            const namePattern = /<td[^>]*>([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)<\/td>/g;
            while ((match = namePattern.exec(dirSection[0])) !== null) {
              if (match[1].length > 4 && match[1].length < 50) {
                officers.push({
                  name: match[1].trim(),
                  role: 'Director',
                  appointedDate: null,
                  resignedDate: null,
                  nationality: 'Indian',
                  dateOfBirth: null,
                  source: 'opencorporates',
                });
              }
            }
          }
        }

        this.logger.log(`India officers for ${cin}: ${officers.length} found`);
        return officers;
      } catch (e: any) {
        this.logger.warn(`India officers failed for ${cin}: ${e?.message}`);
        return [];
      }
    });
  }
}
