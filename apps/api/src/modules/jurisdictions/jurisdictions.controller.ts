import { Public } from '../auth/guards/jwt-auth.guard';
import { Controller, Get, Query } from '@nestjs/common';
import { getAllJurisdictions, getJurisdictionChoices, getJurisdiction } from './jurisdiction.registry';
import { OpenCorporatesProvider } from './providers/opencorporates.provider';
import { SecEdgarProvider } from './providers/sec-edgar.provider';
import { GleifProvider } from './providers/gleif.provider';
import { IndiaMcaProvider } from './providers/india-mca.provider';
import { FranceSireneProvider } from './providers/france-sirene.provider';
import { GermanyNorthdataProvider } from './providers/germany-northdata.provider';
import { CompanySearchResult } from './data-provider.interface';

@Public()
@Controller('jurisdictions')
export class JurisdictionsController {
  private readonly oc = new OpenCorporatesProvider();
  private readonly sec = new SecEdgarProvider();
  private readonly gleif = new GleifProvider();
  private readonly india = new IndiaMcaProvider();
  private readonly france = new FranceSireneProvider();
  private readonly germany = new GermanyNorthdataProvider();

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
      // Global search via GLEIF + OpenCorporates fallback
      const [gleifResults, ocResults] = await Promise.all([
        this.gleif.searchCompanies(query),
        this.oc.searchCompanies(query).catch(() => []),
      ]);
      results.push(...gleifResults, ...ocResults);
    } else if (jCode === 'us') {
      // SEC first (has tickers + richer data), GLEIF after
      const secResults = await this.sec.searchCompanies(query);
      console.log(`SEC returned ${secResults.length} results for "${query}"`);
      results.push(...secResults);
      // Only add GLEIF if SEC returned few results
      if (secResults.length < 10) {
        const gleifResults = await this.gleif.searchCompanies(query, 'US');
        results.push(...gleifResults);
      }
    } else if (jCode === 'in') {
      // India: MCA provider first, then GLEIF
      const [indiaResults, gleifResults] = await Promise.all([
        this.india.searchCompanies(query).catch(() => []),
        this.gleif.searchCompanies(query, 'IN').catch(() => []),
      ]);
      results.push(...indiaResults, ...gleifResults);
    } else if (jCode === 'fr') {
      // France: Sirene API (free, rich data)
      const [franceResults, gleifResults] = await Promise.all([
        this.france.searchCompanies(query).catch(() => []),
        this.gleif.searchCompanies(query, 'FR').catch(() => []),
      ]);
      results.push(...franceResults, ...gleifResults);
    } else if (jCode === 'de') {
      // Germany: North Data + GLEIF
      const [germanyResults, gleifResults] = await Promise.all([
        this.germany.searchCompanies(query).catch(() => []),
        this.gleif.searchCompanies(query, 'DE').catch(() => []),
      ]);
      results.push(...germanyResults, ...gleifResults);
    } else {
      // Specific jurisdiction via GLEIF + OpenCorporates fallback
      const [gleifResults, ocResults] = await Promise.all([
        this.gleif.searchCompanies(query, jCode),
        this.oc.searchCompanies(query, jCode).catch(() => []),
      ]);
      results.push(...gleifResults, ...ocResults);
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
