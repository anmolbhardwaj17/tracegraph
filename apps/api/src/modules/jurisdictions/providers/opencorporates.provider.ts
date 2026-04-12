import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer, Filing,
  DataSource, DataDepth,
} from '../data-provider.interface';

const BASE = 'https://api.opencorporates.com/v0.4';
const RATE_LIMIT_DELAY = 220; // ~5 req/sec

// Simple in-memory cache (TTL 24h)
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

function normalizeStatus(raw: string): CompanyProfile['status'] {
  const s = (raw || '').toLowerCase();
  if (s.includes('active') || s.includes('good standing')) return 'active';
  if (s.includes('dissolv') || s.includes('struck') || s.includes('cancelled')) return 'dissolved';
  if (s.includes('liquid')) return 'liquidation';
  if (s.includes('admin')) return 'administration';
  return 'unknown';
}

@Injectable()
export class OpenCorporatesProvider implements CompanyDataProvider {
  private readonly logger = new Logger(OpenCorporatesProvider.name);
  readonly source: DataSource = 'opencorporates';
  readonly dataDepth: DataDepth = 'basic';

  async searchCompanies(query: string, jurisdictionCode?: string): Promise<CompanySearchResult[]> {
    const cacheKey = `oc:search:${query}:${jurisdictionCode || 'all'}`;
    return cached(cacheKey, async () => {
      try {
        const params: any = { q: query, per_page: 20 };
        if (jurisdictionCode) params.jurisdiction_code = jurisdictionCode;
        const apiKey = process.env.OPENCORPORATES_API_KEY;
        if (apiKey) params.api_token = apiKey;

        const res = await rateLimited(() =>
          axios.get(`${BASE}/companies/search`, { params, timeout: 10000 }),
        );

        const companies = res.data?.results?.companies || [];
        return companies.map((c: any) => {
          const co = c.company;
          return {
            name: co.name,
            companyNumber: co.company_number,
            jurisdiction: co.jurisdiction_code,
            status: co.current_status || 'unknown',
            incorporationDate: co.incorporation_date || null,
            registryUrl: co.opencorporates_url || '',
            source: 'opencorporates' as DataSource,
          };
        });
      } catch (e: any) {
        this.logger.warn(`OpenCorporates search failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyProfile(companyNumber: string, jurisdictionCode?: string): Promise<CompanyProfile | null> {
    if (!jurisdictionCode) return null;
    const cacheKey = `oc:profile:${jurisdictionCode}:${companyNumber}`;
    return cached(cacheKey, async () => {
      try {
        const params: any = {};
        const apiKey = process.env.OPENCORPORATES_API_KEY;
        if (apiKey) params.api_token = apiKey;

        const res = await rateLimited(() =>
          axios.get(`${BASE}/companies/${jurisdictionCode}/${companyNumber}`, { params, timeout: 10000 }),
        );

        const co = res.data?.results?.company;
        if (!co) return null;

        const addr = co.registered_address;
        const addressStr = addr
          ? [addr.street_address, addr.locality, addr.region, addr.postal_code, addr.country].filter(Boolean).join(', ')
          : null;

        return {
          name: co.name,
          companyNumber: co.company_number,
          jurisdiction: co.jurisdiction_code,
          jurisdictionLabel: co.jurisdiction_code?.toUpperCase() || 'Unknown',
          status: normalizeStatus(co.current_status),
          incorporationDate: co.incorporation_date || null,
          dissolutionDate: co.dissolution_date || null,
          companyType: co.company_type || null,
          registeredAddress: addressStr,
          sicCodes: co.industry_codes?.map((ic: any) => ic.industry_code?.code).filter(Boolean) || [],
          registryUrl: co.opencorporates_url || '',
          source: 'opencorporates',
          dataDepth: 'basic',
        } as CompanyProfile;
      } catch (e: any) {
        this.logger.warn(`OpenCorporates profile failed: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(companyNumber: string, jurisdictionCode?: string): Promise<Officer[]> {
    if (!jurisdictionCode) return [];
    const cacheKey = `oc:officers:${jurisdictionCode}:${companyNumber}`;
    return cached(cacheKey, async () => {
      try {
        const params: any = {};
        const apiKey = process.env.OPENCORPORATES_API_KEY;
        if (apiKey) params.api_token = apiKey;

        const res = await rateLimited(() =>
          axios.get(`${BASE}/companies/${jurisdictionCode}/${companyNumber}/officers`, { params, timeout: 10000 }),
        );

        const officers = res.data?.results?.officers || [];
        return officers.map((o: any) => {
          const off = o.officer;
          return {
            name: off.name,
            role: off.position || 'director',
            appointedDate: off.start_date || null,
            resignedDate: off.end_date || null,
            nationality: off.nationality || null,
            dateOfBirth: null,
            source: 'opencorporates' as DataSource,
          };
        });
      } catch (e: any) {
        this.logger.warn(`OpenCorporates officers failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyFilings(companyNumber: string, jurisdictionCode?: string): Promise<Filing[]> {
    if (!jurisdictionCode) return [];
    const cacheKey = `oc:filings:${jurisdictionCode}:${companyNumber}`;
    return cached(cacheKey, async () => {
      try {
        const params: any = {};
        const apiKey = process.env.OPENCORPORATES_API_KEY;
        if (apiKey) params.api_token = apiKey;

        const res = await rateLimited(() =>
          axios.get(`${BASE}/companies/${jurisdictionCode}/${companyNumber}/filings`, { params, timeout: 10000 }),
        );

        const filings = res.data?.results?.filings || [];
        return filings.slice(0, 50).map((f: any) => {
          const fil = f.filing;
          return {
            date: fil.date || '',
            type: fil.filing_type || '',
            description: fil.description || fil.title || '',
            url: fil.opencorporates_url || null,
          };
        });
      } catch {
        return [];
      }
    });
  }
}
