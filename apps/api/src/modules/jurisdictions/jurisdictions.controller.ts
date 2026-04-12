import { Controller, Get, Query } from '@nestjs/common';
import { getAllJurisdictions, getJurisdictionChoices, getJurisdiction } from './jurisdiction.registry';
import { OpenCorporatesProvider } from './providers/opencorporates.provider';
import { SecEdgarProvider } from './providers/sec-edgar.provider';
import { CompanySearchResult } from './data-provider.interface';

@Controller('jurisdictions')
export class JurisdictionsController {
  private readonly oc = new OpenCorporatesProvider();
  private readonly sec = new SecEdgarProvider();

  @Get()
  list() {
    return getAllJurisdictions();
  }

  @Get('choices')
  choices() {
    return getJurisdictionChoices();
  }

  @Get('search')
  async search(@Query('q') q: string, @Query('jurisdiction') jurisdiction?: string) {
    if (!q || q.trim().length < 2) return { items: [] };
    const query = q.trim();
    const jCode = (jurisdiction || 'gb').toLowerCase();

    if (jCode === 'gb') {
      // Proxy to existing Companies House search — handled by CH controller
      return { items: [], redirect: 'companies-house' };
    }

    const results: CompanySearchResult[] = [];

    if (jCode === 'all') {
      // Global search via OpenCorporates
      const ocResults = await this.oc.searchCompanies(query);
      results.push(...ocResults);
    } else if (jCode === 'us') {
      // Search both OpenCorporates and SEC
      const [ocResults, secResults] = await Promise.all([
        this.oc.searchCompanies(query, 'us'),
        this.sec.searchCompanies(query),
      ]);
      results.push(...ocResults, ...secResults);
    } else {
      // Specific jurisdiction via OpenCorporates
      const ocResults = await this.oc.searchCompanies(query, jCode);
      results.push(...ocResults);
    }

    // Deduplicate by name
    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      const key = r.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      items: deduped.slice(0, 20).map((r) => ({
        ...r,
        jurisdictionLabel: getJurisdiction(r.jurisdiction).label,
        flag: getJurisdiction(r.jurisdiction).flag,
      })),
    };
  }
}
