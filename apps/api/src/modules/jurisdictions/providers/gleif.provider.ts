import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer,
  DataSource, DataDepth,
} from '../data-provider.interface';

const BASE = 'https://api.gleif.org/api/v1';
const RATE_LIMIT_DELAY = 120; // ~8 req/sec to be safe

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
  const s = (raw || '').toUpperCase();
  if (s === 'ACTIVE') return 'active';
  if (s === 'INACTIVE' || s === 'LAPSED') return 'dissolved';
  return 'unknown';
}

function buildAddress(addr: any): string | null {
  if (!addr) return null;
  const parts = [...(addr.addressLines || []), addr.city, addr.region, addr.postalCode, addr.country].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

@Injectable()
export class GleifProvider implements CompanyDataProvider {
  private readonly logger = new Logger(GleifProvider.name);
  readonly source: DataSource = 'opencorporates'; // We'll show as 'GLEIF' in UI but type-compatible
  readonly dataDepth: DataDepth = 'moderate';

  async searchCompanies(query: string, jurisdictionCode?: string): Promise<CompanySearchResult[]> {
    const cacheKey = `gleif:search:${query}:${jurisdictionCode || 'all'}`;
    return cached(cacheKey, async () => {
      try {
        const params: any = {
          'filter[entity.legalName]': query,
          'page[size]': 20,
        };
        if (jurisdictionCode && jurisdictionCode !== 'all') {
          params['filter[entity.jurisdiction]'] = jurisdictionCode.toUpperCase();
        }

        const res = await rateLimited(() =>
          axios.get(`${BASE}/lei-records`, { params, timeout: 10000 }),
        );

        return (res.data?.data || []).map((item: any) => {
          const a = item.attributes || {};
          const e = a.entity || {};
          return {
            name: e.legalName?.name || 'Unknown',
            companyNumber: a.lei || item.id,
            jurisdiction: (e.jurisdiction || '').toLowerCase().split('-')[0],
            status: e.status || 'unknown',
            incorporationDate: null,
            registryUrl: `https://search.gleif.org/#/record/${a.lei}`,
            source: 'opencorporates' as DataSource,
          };
        });
      } catch (e: any) {
        this.logger.warn(`GLEIF search failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyProfile(lei: string): Promise<CompanyProfile | null> {
    const cacheKey = `gleif:profile:${lei}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${BASE}/lei-records/${lei}`, { timeout: 10000 }),
        );

        const a = res.data?.data?.attributes || {};
        const e = a.entity || {};
        const jurisdiction = (e.jurisdiction || '').toLowerCase();

        return {
          name: e.legalName?.name || 'Unknown',
          companyNumber: a.lei,
          jurisdiction: jurisdiction.split('-')[0],
          jurisdictionLabel: jurisdiction.toUpperCase(),
          status: normalizeStatus(e.status),
          incorporationDate: a.registration?.initialRegistrationDate || null,
          dissolutionDate: null,
          companyType: e.legalForm?.id || e.category || null,
          registeredAddress: buildAddress(e.legalAddress),
          sicCodes: [],
          registryUrl: `https://search.gleif.org/#/record/${a.lei}`,
          source: 'opencorporates' as DataSource,
          dataDepth: 'moderate',
        } as CompanyProfile;
      } catch (e: any) {
        this.logger.warn(`GLEIF profile failed for ${lei}: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(): Promise<Officer[]> {
    // GLEIF doesn't provide officer data directly
    return [];
  }

  /** Get direct parent entity — GLEIF's killer feature */
  async getDirectParent(lei: string): Promise<CompanyProfile | null> {
    const cacheKey = `gleif:parent:${lei}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${BASE}/lei-records/${lei}/direct-parent`, { timeout: 10000 }),
        );
        const a = res.data?.data?.attributes || {};
        const e = a.entity || {};
        if (!e.legalName?.name) return null;
        return {
          name: e.legalName.name,
          companyNumber: a.lei,
          jurisdiction: (e.jurisdiction || '').toLowerCase().split('-')[0],
          jurisdictionLabel: (e.jurisdiction || '').toUpperCase(),
          status: normalizeStatus(e.status),
          incorporationDate: null,
          dissolutionDate: null,
          companyType: e.legalForm?.id || null,
          registeredAddress: buildAddress(e.legalAddress),
          sicCodes: [],
          registryUrl: `https://search.gleif.org/#/record/${a.lei}`,
          source: 'opencorporates' as DataSource,
          dataDepth: 'moderate',
        } as CompanyProfile;
      } catch {
        return null;
      }
    });
  }

  /** Get ultimate parent entity */
  async getUltimateParent(lei: string): Promise<CompanyProfile | null> {
    const cacheKey = `gleif:ultimate:${lei}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${BASE}/lei-records/${lei}/ultimate-parent`, { timeout: 10000 }),
        );
        const a = res.data?.data?.attributes || {};
        const e = a.entity || {};
        if (!e.legalName?.name) return null;
        return {
          name: e.legalName.name,
          companyNumber: a.lei,
          jurisdiction: (e.jurisdiction || '').toLowerCase().split('-')[0],
          jurisdictionLabel: (e.jurisdiction || '').toUpperCase(),
          status: normalizeStatus(e.status),
          incorporationDate: null,
          dissolutionDate: null,
          companyType: e.legalForm?.id || null,
          registeredAddress: buildAddress(e.legalAddress),
          sicCodes: [],
          registryUrl: `https://search.gleif.org/#/record/${a.lei}`,
          source: 'opencorporates' as DataSource,
          dataDepth: 'moderate',
        } as CompanyProfile;
      } catch {
        return null;
      }
    });
  }

  /** Get all child entities (subsidiaries) */
  async getChildren(lei: string): Promise<CompanyProfile[]> {
    const cacheKey = `gleif:children:${lei}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${BASE}/lei-records`, {
            params: { 'filter[entity.directParent]': lei, 'page[size]': 50 },
            timeout: 10000,
          }),
        );
        return (res.data?.data || []).map((item: any) => {
          const a = item.attributes || {};
          const e = a.entity || {};
          return {
            name: e.legalName?.name || 'Unknown',
            companyNumber: a.lei,
            jurisdiction: (e.jurisdiction || '').toLowerCase().split('-')[0],
            jurisdictionLabel: (e.jurisdiction || '').toUpperCase(),
            status: normalizeStatus(e.status),
            incorporationDate: null,
            dissolutionDate: null,
            companyType: e.legalForm?.id || null,
            registeredAddress: buildAddress(e.legalAddress),
            sicCodes: [],
            registryUrl: `https://search.gleif.org/#/record/${a.lei}`,
            source: 'opencorporates' as DataSource,
            dataDepth: 'moderate',
          } as CompanyProfile;
        });
      } catch {
        return [];
      }
    });
  }
}
