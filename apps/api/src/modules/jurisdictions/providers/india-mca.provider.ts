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

      // Source 1: DuckDuckGo → find Tofler company pages (gets CIN + name)
      try {
        const searchRes = await rl(() =>
          axios.get('https://html.duckduckgo.com/html/', {
            params: { q: `site:tofler.in ${query} company` },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
          }),
        );
        const html = searchRes.data as string;
        // Extract Tofler company URLs with CIN
        const toflerLinks = html.match(/tofler\.in\/([a-z0-9\-]+)\/company\/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/gi) || [];
        const seen = new Set<string>();
        for (const link of toflerLinks.slice(0, 10)) {
          const match = link.match(/tofler\.in\/([a-z0-9\-]+)\/company\/([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/i);
          if (!match || seen.has(match[2])) continue;
          seen.add(match[2]);
          const name = match[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          results.push({
            name,
            companyNumber: match[2],
            jurisdiction: 'in',
            status: 'active',
            incorporationDate: null,
            registryUrl: `https://www.tofler.in/${match[1]}/company/${match[2]}`,
            source: 'opencorporates' as DataSource,
          });
        }
        if (results.length > 0) {
          this.logger.log(`India search: found ${results.length} companies via Tofler/DuckDuckGo`);
        }
      } catch (e: any) {
        this.logger.warn(`Tofler/DuckDuckGo search failed: ${e?.message}`);
      }

      return results;
    });
  }

  async getCompanyProfile(cin: string): Promise<CompanyProfile | null> {
    return cached(`india:profile:${cin}`, async () => {
      try {
        // Use Tofler — need to construct the URL slug from CIN
        // First search for the CIN to get the slug
        const searchRes = await rl(() =>
          axios.get('https://html.duckduckgo.com/html/', {
            params: { q: `site:tofler.in company ${cin}` },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
          }),
        );
        const searchHtml = searchRes.data as string;
        const urlMatch = searchHtml.match(new RegExp(`tofler\\.in/([a-z0-9\\-]+)/company/${cin}`, 'i'));
        if (!urlMatch) {
          this.logger.warn(`Tofler: no page found for CIN ${cin}`);
          return null;
        }

        const toflerUrl = `https://www.tofler.in/${urlMatch[1]}/company/${cin}`;
        const res = await rl(() =>
          axios.get(toflerUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: 15000, responseType: 'text' }),
        );

        const html = res.data as string;
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

        // Extract from JSON-LD FAQ schema
        const faqMatch = html.match(/"FAQPage".*?"mainEntity"\s*:\s*\[(.*?)\]/s);
        let incDate: string | null = null;
        let capital: string | null = null;
        if (faqMatch) {
          const incMatch = faqMatch[1].match(/incorporation date.*?(\d{1,2}\s+\w+,?\s+\d{4})/i);
          if (incMatch) incDate = incMatch[1];
          const capMatch = faqMatch[1].match(/authorized share capital.*?Rs\.?\s*([\d,]+)/i);
          if (capMatch) capital = capMatch[1];
        }

        // Extract from page text
        const nameMatch = text.match(/CIN.*?([A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}).*?([A-Z][A-Z\s&.,']+(?:LIMITED|LTD|PRIVATE|PVT))/i)
          || html.match(/<title>([^<]+)/);
        const name = nameMatch?.[2]?.trim() || nameMatch?.[1]?.replace(/ Financials.*/, '').trim() || cin;
        const statusMatch = text.match(/(?:Status|Company Status)[:\s]*(Active|Dormant|Struck Off)/i);
        const addressMatch = text.match(/(?:Registered (?:Office )?Address)[:\s]*([^.]{10,200})/i);

        return {
          name: name.replace(/ Financials.*/, '').trim(),
          companyNumber: cin,
          jurisdiction: 'in',
          jurisdictionLabel: 'India',
          status: statusMatch?.[1]?.toLowerCase() === 'active' ? 'active' : 'unknown',
          incorporationDate: incDate || null,
          dissolutionDate: null,
          companyType: null,
          registeredAddress: addressMatch?.[1]?.trim() || null,
          sicCodes: [],
          registryUrl: toflerUrl,
          source: 'opencorporates' as DataSource,
          dataDepth: 'basic' as DataDepth,
        };
      } catch (e: any) {
        this.logger.warn(`India company profile failed for ${cin}: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(cin: string): Promise<Officer[]> {
    // Officers are extracted from Wikidata + NSE data during enrichment
    // Tofler requires paid subscription for director data
    return [];
  }
}
