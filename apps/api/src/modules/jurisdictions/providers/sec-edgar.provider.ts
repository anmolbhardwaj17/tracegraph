import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer, Filing,
  DataSource, DataDepth,
} from '../data-provider.interface';

const DATA_BASE = 'https://data.sec.gov';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';
const RATE_LIMIT_DELAY = 110;

// Response cache
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

function padCik(cik: string | number): string {
  return String(cik).replace(/^0+/, '').padStart(10, '0');
}

// SIC code descriptions (common ones)
const SIC_MAP: Record<string, string> = {
  '5961': 'Retail - Catalog & Mail-Order', '7372': 'Prepackaged Software',
  '3711': 'Motor Vehicles & Passenger Car Bodies', '3674': 'Semiconductors',
  '7371': 'Computer Programming & Data Processing', '6022': 'State Commercial Banks',
  '4813': 'Telephone Communications', '2834': 'Pharmaceutical Preparations',
  '3714': 'Motor Vehicle Parts & Accessories', '5065': 'Electronic Parts & Equipment',
  '7374': 'Computer Processing & Data Preparation', '6020': 'Savings Institutions',
  '3841': 'Surgical & Medical Instruments', '2860': 'Industrial Chemicals',
};

interface TickerEntry {
  cik: number;
  title: string;
  ticker: string;
}

@Injectable()
export class SecEdgarProvider implements CompanyDataProvider, OnModuleInit {
  private readonly logger = new Logger(SecEdgarProvider.name);
  readonly source: DataSource = 'sec-edgar';
  readonly dataDepth: DataDepth = 'moderate';
  private readonly headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

  // In-memory ticker database (loaded on startup)
  private tickers: TickerEntry[] = [];
  private tickersBySymbol = new Map<string, TickerEntry>();
  private tickerLoaded = false;

  async onModuleInit() {
    this.loadTickers().catch((e) => this.logger.warn(`Failed to load SEC tickers: ${e?.message}`));
  }

  private async loadTickers(): Promise<void> {
    try {
      const res = await axios.get('https://www.sec.gov/files/company_tickers.json', {
        headers: this.headers, timeout: 15000,
      });
      const data = res.data || {};
      this.tickers = Object.values(data) as TickerEntry[];
      for (const t of this.tickers) {
        this.tickersBySymbol.set(t.ticker?.toUpperCase(), t);
      }
      this.tickerLoaded = true;
      this.logger.log(`Loaded ${this.tickers.length} SEC company tickers`);
    } catch (e: any) {
      this.logger.warn(`SEC tickers load failed: ${e?.message}`);
    }
  }

  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    // Ensure tickers are loaded
    if (!this.tickerLoaded) await this.loadTickers();

    const q = query.trim().toLowerCase();
    const results: CompanySearchResult[] = [];

    // 1. Exact ticker match (highest priority)
    const tickerMatch = this.tickersBySymbol.get(query.trim().toUpperCase());
    if (tickerMatch) {
      results.push(this.tickerToResult(tickerMatch));
    }

    // 2. Fuzzy name search across all tickers
    const nameMatches = this.tickers
      .filter((t) => {
        const title = t.title.toLowerCase();
        // Exact substring match
        if (title.includes(q)) return true;
        // Match each word
        const words = q.split(/\s+/);
        return words.every((w) => title.includes(w));
      })
      .filter((t) => t.cik !== tickerMatch?.cik) // exclude already-added ticker match
      .slice(0, 19);

    for (const m of nameMatches) {
      results.push(this.tickerToResult(m));
    }

    return results.slice(0, 20);
  }

  private tickerToResult(t: TickerEntry): CompanySearchResult {
    return {
      name: t.title,
      companyNumber: String(t.cik),
      jurisdiction: 'us',
      status: 'active',
      incorporationDate: null,
      registryUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${t.cik}`,
      source: 'sec-edgar',
      // Extra fields for display
      ...(({ ticker: t.ticker }) as any),
    };
  }

  async getCompanyProfile(cik: string): Promise<CompanyProfile | null> {
    const paddedCik = padCik(cik);
    const cacheKey = `sec:profile:${paddedCik}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${paddedCik}.json`, {
            headers: this.headers, timeout: 10000,
          }),
        );

        const d = res.data;
        if (!d) return null;

        const addr = d.addresses?.business || d.addresses?.mailing || {};
        const addressStr = [addr.street1, addr.street2, addr.city, addr.stateOrCountry, addr.zipCode]
          .filter(Boolean).join(', ');

        const sicDesc = d.sicDescription || SIC_MAP[d.sic] || null;

        return {
          name: d.name || cik,
          companyNumber: cik,
          jurisdiction: 'us',
          jurisdictionLabel: 'United States',
          status: d.tickers?.length > 0 ? 'active' : 'unknown',
          incorporationDate: null,
          dissolutionDate: null,
          companyType: d.entityType || d.category || null,
          registeredAddress: addressStr || null,
          sicCodes: d.sic ? [d.sic] : [],
          registryUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}`,
          source: 'sec-edgar',
          dataDepth: 'moderate',
          // Extra SEC-specific fields
          ...({
            ticker: d.tickers?.[0] || null,
            exchange: d.exchanges?.[0] || null,
            sicDescription: sicDesc,
            stateOfIncorporation: d.stateOfIncorporation || null,
            fiscalYearEnd: d.fiscalYearEnd || null,
            category: d.category || null,
            formerNames: (d.formerNames || []).map((fn: any) => fn.name),
            totalFilings: d.filings?.recent?.form?.length || 0,
          } as any),
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
        // Get recent insider filings (Form 4) to extract officers and directors
        const res = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${paddedCik}.json`, {
            headers: this.headers, timeout: 10000,
          }),
        );

        const d = res.data;
        const officers: Officer[] = [];
        const seen = new Set<string>();

        // Parse Form 4 filings (insider trading) to find officers/directors
        const filings = d.filings?.recent || {};
        const forms = filings.form || [];
        const names = filings.reportingOwner || [];
        const dates = filings.filingDate || [];

        // Form 4 filings list the reporting owner (officer/director)
        // We can also check the company filing for DEF 14A (proxy) or 10-K
        for (let i = 0; i < Math.min(forms.length, 200); i++) {
          if (forms[i] !== '4' && forms[i] !== '4/A') continue;
          // The primaryDocDescription sometimes contains the officer name
          const desc = filings.primaryDocDescription?.[i] || '';
          // Try to extract from accession number filing
          const accession = filings.accessionNumber?.[i];
          if (!accession) continue;

          // For Form 4s, the filing name itself is often the officer
          // We'll parse this from the actual filing later
          // For now, use the reporting owners if available
        }

        // Fallback: search for DEF 14A (proxy statement) which lists all officers
        // For now, return what we can extract from the submissions data
        if (d.officers) {
          for (const off of d.officers) {
            const name = off.name || off.officerName || '';
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            officers.push({
              name, role: off.title || off.position || 'Officer',
              appointedDate: null, resignedDate: null,
              nationality: null, dateOfBirth: null, source: 'sec-edgar',
            });
          }
        }

        // Try to get officers from recent 10-K or DEF 14A
        // Parse Form 4 filers as backup source of officer names
        for (let i = 0; i < Math.min(forms.length, 500); i++) {
          if (forms[i] !== '4') continue;
          const filerName = filings.primaryDocDescription?.[i] || '';
          // Sometimes the description has "Statement of Changes... by LASTNAME, FIRSTNAME"
          // But more reliably we'd need to parse the XML
          // For now skip this complex parsing
        }

        return officers;
      } catch (e: any) {
        this.logger.warn(`SEC officers failed for CIK ${cik}: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyFilings(cik: string): Promise<Filing[]> {
    const paddedCik = padCik(cik);
    const cacheKey = `sec:filings:${paddedCik}`;
    return cached(cacheKey, async () => {
      try {
        const res = await rateLimited(() =>
          axios.get(`${DATA_BASE}/submissions/CIK${paddedCik}.json`, {
            headers: this.headers, timeout: 10000,
          }),
        );

        const filings = res.data?.filings?.recent || {};
        const forms = filings.form || [];
        const dates = filings.filingDate || [];
        const descs = filings.primaryDocDescription || [];
        const accessions = filings.accessionNumber || [];

        const results: Filing[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < Math.min(forms.length, 100); i++) {
          // Skip duplicate form 4s, keep unique filing types
          const key = `${forms[i]}-${dates[i]}`;
          if (forms[i] === '4' && seen.has('4')) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          if (forms[i] === '4') seen.add('4');

          const accClean = (accessions[i] || '').replace(/-/g, '');
          results.push({
            date: dates[i] || '',
            type: forms[i] || '',
            description: descs[i] || forms[i] || '',
            url: accessions[i] ? `https://www.sec.gov/Archives/edgar/data/${cik}/${accClean}/${accessions[i]}-index.htm` : null,
          });
        }

        return results.slice(0, 50);
      } catch {
        return [];
      }
    });
  }
}
