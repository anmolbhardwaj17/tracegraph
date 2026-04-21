import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  CompanyDataProvider, CompanySearchResult, CompanyProfile, Officer,
  DataSource, DataDepth,
} from '../data-provider.interface';

/**
 * Germany Company Provider — scrapes North Data JSON-LD.
 *
 * North Data indexes German Handelsregister data and serves it publicly.
 * We scrape the JSON-LD structured data (Schema.org Organization) from
 * company pages found via DuckDuckGo.
 *
 * Data: founding date, address, directors (members), company number (HRB).
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

@Injectable()
export class GermanyNorthdataProvider implements CompanyDataProvider {
  private readonly logger = new Logger(GermanyNorthdataProvider.name);
  readonly source: DataSource = 'opencorporates';
  readonly dataDepth: DataDepth = 'basic';

  async searchCompanies(query: string): Promise<CompanySearchResult[]> {
    return cached(`germany:search:${query.toLowerCase()}`, async () => {
      try {
        // Use DuckDuckGo to find North Data company pages
        const searchRes = await axios.get('https://html.duckduckgo.com/html/', {
          params: { q: `site:northdata.com ${query} Germany` },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 10000,
        });

        const html = searchRes.data as string;
        const results: CompanySearchResult[] = [];
        const seen = new Set<string>();

        // Extract North Data URLs
        const linkPattern = /northdata\.com\/([^"&\s]+)/gi;
        let match;
        while ((match = linkPattern.exec(html)) !== null && results.length < 10) {
          const path = decodeURIComponent(match[1]).replace(/\+/g, ' ');
          // Path format: "Company+Name,+City/HRB+12345"
          const parts = path.split('/');
          if (parts.length < 1) continue;
          const companyPart = parts[0].replace(/,.*$/, '').trim();
          if (seen.has(companyPart) || companyPart.length < 3) continue;
          seen.add(companyPart);

          results.push({
            name: companyPart,
            companyNumber: parts[1] || '',
            jurisdiction: 'de',
            status: 'active',
            incorporationDate: null,
            registryUrl: `https://www.northdata.com/${match[1]}`,
            source: 'opencorporates' as DataSource,
          });
        }

        if (results.length > 0) {
          this.logger.log(`Germany search: found ${results.length} via North Data/DuckDuckGo`);
        }
        return results;
      } catch (e: any) {
        this.logger.warn(`Germany search failed: ${e?.message}`);
        return [];
      }
    });
  }

  async getCompanyProfile(companyIdOrUrl: string): Promise<CompanyProfile | null> {
    return cached(`germany:profile:${companyIdOrUrl}`, async () => {
      try {
        // If it's a North Data URL, fetch directly; otherwise search first
        let url = companyIdOrUrl;
        if (!url.startsWith('http')) {
          // Search for the company first
          const results = await this.searchCompanies(companyIdOrUrl);
          if (results.length === 0) return null;
          url = results[0].registryUrl;
        }

        const res = await axios.get(url, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
          responseType: 'text',
        });

        const html = res.data as string;

        // Extract JSON-LD
        const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        let orgData: any = null;

        for (const ldBlock of ldMatches) {
          try {
            const json = ldBlock.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const parsed = JSON.parse(json);
            if (parsed['@type'] === 'LocalBusiness' || parsed['@type'] === 'Organization') {
              orgData = parsed;
              break;
            }
          } catch { continue; }
        }

        if (!orgData) return null;

        const addr = orgData.address || {};
        const address = [addr.streetAddress, addr.postalCode, addr.addressLocality].filter(Boolean).join(', ');

        return {
          name: orgData.name || companyIdOrUrl,
          companyNumber: companyIdOrUrl,
          jurisdiction: 'de',
          jurisdictionLabel: 'Germany',
          status: 'active',
          incorporationDate: orgData.foundingDate || null,
          dissolutionDate: null,
          companyType: null,
          registeredAddress: address || null,
          sicCodes: [],
          registryUrl: url,
          source: 'opencorporates' as DataSource,
          dataDepth: 'basic' as DataDepth,
        };
      } catch (e: any) {
        this.logger.warn(`Germany profile failed: ${e?.message}`);
        return null;
      }
    });
  }

  async getCompanyOfficers(companyIdOrUrl: string): Promise<Officer[]> {
    return cached(`germany:officers:${companyIdOrUrl}`, async () => {
      try {
        let url = companyIdOrUrl;
        if (!url.startsWith('http')) {
          const results = await this.searchCompanies(companyIdOrUrl);
          if (results.length === 0) return [];
          url = results[0].registryUrl;
        }

        const res = await axios.get(url, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
          responseType: 'text',
        });

        const html = res.data as string;
        const officers: Officer[] = [];

        // Extract from JSON-LD members
        const ldMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
        for (const ldBlock of ldMatches) {
          try {
            const json = ldBlock.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
            const parsed = JSON.parse(json);
            if (parsed.member && Array.isArray(parsed.member)) {
              for (const m of parsed.member) {
                const name = m.name || [m.givenName, m.familyName].filter(Boolean).join(' ');
                if (name && name.length > 2) {
                  officers.push({
                    name,
                    role: m.roleName || m.jobTitle || 'Director',
                    appointedDate: null,
                    resignedDate: null,
                    nationality: 'German',
                    dateOfBirth: null,
                    source: 'opencorporates' as DataSource,
                  });
                }
              }
            }
          } catch { continue; }
        }

        this.logger.log(`Germany officers: ${officers.length} found`);
        return officers;
      } catch (e: any) {
        this.logger.warn(`Germany officers failed: ${e?.message}`);
        return [];
      }
    });
  }
}
