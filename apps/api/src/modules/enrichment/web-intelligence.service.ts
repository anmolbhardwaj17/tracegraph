import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface WebsiteCheck {
  url: string | null;
  exists: boolean;
  statusCode: number | null;
  domainAge: string | null;
  domainRegistrar: string | null;
  isParked: boolean;
  sslValid: boolean;
  flags: string[];
}

export interface GovernmentContract {
  awardId: string;
  description: string;
  amount: number;
  agency: string;
  startDate: string;
  endDate: string;
}

export interface CourtCase {
  caseName: string;
  caseNumber: string;
  court: string;
  dateFiled: string;
  url: string;
}

/**
 * Web Intelligence Service.
 *
 * 1. Company Website Verification — check if website exists, domain age, SSL, parked page detection
 * 2. Government Contracts — USAspending.gov API for federal contracts
 * 3. Court Records — CourtListener API for federal litigation
 */
@Injectable()
export class WebIntelligenceService {
  private readonly logger = new Logger(WebIntelligenceService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async analyze(
    investigationId: string,
    companyName: string,
    website: string | null,
  ): Promise<{
    websiteCheck: WebsiteCheck;
    govContracts: GovernmentContract[];
    courtCases: CourtCase[];
    findings: Finding[];
  }> {
    this.logger.log(`Web Intelligence: analyzing ${companyName}`);

    const [websiteCheck, govContracts, courtCases] = await Promise.all([
      this.checkWebsite(website || this.guessWebsite(companyName)).catch((e) => {
        this.logger.warn(`Website check failed: ${e?.message}`);
        return this.emptyWebsiteCheck();
      }),
      this.getGovernmentContracts(companyName).catch((e) => {
        this.logger.warn(`Gov contracts failed: ${e?.message}`);
        return [] as GovernmentContract[];
      }),
      this.getCourtCases(companyName).catch((e) => {
        this.logger.warn(`Court records failed: ${e?.message}`);
        return [] as CourtCase[];
      }),
    ]);

    const findings = this.generateFindings(companyName, websiteCheck, govContracts, courtCases);

    // Update root node
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company' },
        order: { id: 'ASC' },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.webIntelligence = {
          websiteExists: websiteCheck.exists,
          websiteUrl: websiteCheck.url,
          domainAge: websiteCheck.domainAge,
          websiteFlags: websiteCheck.flags,
          govContractCount: govContracts.length,
          govContractTotal: govContracts.reduce((s, c) => s + c.amount, 0),
          courtCaseCount: courtCases.length,
          analyzedAt: new Date().toISOString(),
        };
        await this.nodes.update(rootNode.id, { metadata: meta });
      }
    } catch {}

    this.logger.log(
      `Web Intelligence complete: website=${websiteCheck.exists ? 'OK' : 'MISSING'}(${websiteCheck.flags.length} flags), ` +
      `${govContracts.length} gov contracts, ${courtCases.length} court cases, ${findings.length} findings`,
    );

    return { websiteCheck, govContracts, courtCases, findings };
  }

  // ═══════════════════════════════════════════
  // 1. WEBSITE VERIFICATION
  // ═══════════════════════════════════════════

  private async checkWebsite(url: string | null): Promise<WebsiteCheck> {
    if (!url) return { ...this.emptyWebsiteCheck(), flags: ['NO_WEBSITE_URL'] };

    return cached(`web:site:${url}`, async () => {
      const result: WebsiteCheck = {
        url,
        exists: false,
        statusCode: null,
        domainAge: null,
        domainRegistrar: null,
        isParked: false,
        sslValid: false,
        flags: [],
      };

      try {
        // Check if website responds
        const fullUrl = url.startsWith('http') ? url : `https://${url}`;
        const res = await axios.get(fullUrl, {
          timeout: 10000,
          maxRedirects: 5,
          headers: { 'User-Agent': USER_AGENT },
          validateStatus: () => true,
        });

        result.statusCode = res.status;
        result.exists = res.status >= 200 && res.status < 400;
        result.sslValid = fullUrl.startsWith('https://');

        if (!result.exists) {
          result.flags.push('WEBSITE_DOWN');
        }

        // Check for parked page indicators
        const body = (typeof res.data === 'string' ? res.data : '').toLowerCase().slice(0, 5000);
        const parkedIndicators = [
          'this domain is for sale', 'buy this domain', 'parked domain',
          'under construction', 'coming soon', 'godaddy', 'parking page',
          'this page is not available', 'domain has expired',
          'sedo.com', 'afternic.com', 'hugedomains.com',
        ];
        if (parkedIndicators.some((ind) => body.includes(ind))) {
          result.isParked = true;
          result.flags.push('PARKED_DOMAIN');
        }

        // Very thin content could indicate a shell
        if (result.exists && body.length < 500) {
          result.flags.push('MINIMAL_CONTENT');
        }
      } catch (e: any) {
        if (e.code === 'ENOTFOUND') {
          result.flags.push('DOMAIN_NOT_FOUND');
        } else if (e.code === 'CERT_HAS_EXPIRED' || e.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          result.flags.push('SSL_INVALID');
          result.exists = true; // Site exists but SSL is bad
        } else {
          result.flags.push('UNREACHABLE');
        }
      }

      // RDAP domain lookup for age and registrar
      try {
        const domain = this.extractDomain(url);
        if (domain) {
          const rdapRes = await axios.get(`https://rdap.org/domain/${domain}`, {
            timeout: 8000,
            headers: { Accept: 'application/rdap+json' },
          });

          const events = rdapRes.data?.events || [];
          const registration = events.find((e: any) => e.eventAction === 'registration');
          if (registration?.eventDate) {
            result.domainAge = registration.eventDate.split('T')[0];
            // Check if domain is very new (< 1 year)
            const regDate = new Date(registration.eventDate);
            const ageYears = (Date.now() - regDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
            if (ageYears < 1) result.flags.push('DOMAIN_UNDER_1_YEAR');
            if (ageYears < 0.25) result.flags.push('DOMAIN_VERY_NEW');
          }

          const entities = rdapRes.data?.entities || [];
          const registrar = entities.find((e: any) => e.roles?.includes('registrar'));
          if (registrar?.vcardArray?.[1]) {
            const fn = registrar.vcardArray[1].find((v: any) => v[0] === 'fn');
            if (fn) result.domainRegistrar = fn[3];
          }
        }
      } catch {
        // RDAP lookup is optional
      }

      return result;
    });
  }

  private guessWebsite(companyName: string): string | null {
    const clean = companyName
      .toLowerCase()
      .replace(/\b(inc|corp|ltd|plc|llc|co|gmbh|sa|ag|nv|bv|group|holdings)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (clean.length < 2) return null;
    return `https://www.${clean}.com`;
  }

  private extractDomain(url: string): string | null {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════
  // 2. GOVERNMENT CONTRACTS
  // ═══════════════════════════════════════════

  private async getGovernmentContracts(companyName: string): Promise<GovernmentContract[]> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .trim();

    return cached(`web:gov:${searchName.toLowerCase()}`, async () => {
      try {
        const res = await axios.get('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
          method: 'POST',
          timeout: 15000,
          headers: { 'Content-Type': 'application/json' },
          data: {
            filters: {
              keywords: [searchName],
              time_period: [{ start_date: new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end_date: new Date().toISOString().split('T')[0] }],
            },
            fields: ['Award ID', 'Description', 'Award Amount', 'Awarding Agency', 'Start Date', 'End Date'],
            limit: 10,
            page: 1,
            sort: 'Award Amount',
            order: 'desc',
          },
        });

        const results = res.data?.results || [];
        return results.map((r: any) => ({
          awardId: r['Award ID'] || '',
          description: r['Description'] || '',
          amount: r['Award Amount'] || 0,
          agency: r['Awarding Agency'] || '',
          startDate: r['Start Date'] || '',
          endDate: r['End Date'] || '',
        }));
      } catch (e: any) {
        // USAspending API uses POST, retry with POST directly
        try {
          const res = await axios.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
            filters: {
              keywords: [searchName],
              time_period: [{ start_date: new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end_date: new Date().toISOString().split('T')[0] }],
            },
            fields: ['Award ID', 'Description', 'Award Amount', 'Awarding Agency', 'Start Date', 'End Date'],
            limit: 10,
            page: 1,
            sort: 'Award Amount',
            order: 'desc',
          }, { timeout: 15000 });

          const results = res.data?.results || [];
          return results.map((r: any) => ({
            awardId: r['Award ID'] || '',
            description: r['Description'] || '',
            amount: r['Award Amount'] || 0,
            agency: r['Awarding Agency'] || '',
            startDate: r['Start Date'] || '',
            endDate: r['End Date'] || '',
          }));
        } catch {
          return [];
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // 3. COURT RECORDS (CourtListener)
  // ═══════════════════════════════════════════

  private async getCourtCases(companyName: string): Promise<CourtCase[]> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .trim();

    return cached(`web:court:${searchName.toLowerCase()}`, async () => {
      try {
        const res = await axios.get('https://www.courtlistener.com/api/rest/v4/search/', {
          params: {
            q: `"${searchName}"`,
            type: 'r', // RECAP (federal court records)
            order_by: 'dateFiled desc',
            page_size: 10,
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const results = res.data?.results || [];
        return results.slice(0, 10).map((r: any) => ({
          caseName: r.caseName || r.case_name || '',
          caseNumber: r.docketNumber || r.docket_number || '',
          court: r.court || '',
          dateFiled: r.dateFiled || r.date_filed || '',
          url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : '',
        }));
      } catch (e: any) {
        this.logger.warn(`CourtListener search failed: ${e?.message}`);
        return [];
      }
    });
  }

  // ═══════════════════════════════════════════
  // FINDINGS
  // ═══════════════════════════════════════════

  private generateFindings(
    companyName: string,
    website: WebsiteCheck,
    govContracts: GovernmentContract[],
    courtCases: CourtCase[],
  ): Finding[] {
    const findings: Finding[] = [];

    // Website verification findings
    if (website.flags.includes('DOMAIN_NOT_FOUND') || website.flags.includes('NO_WEBSITE_URL')) {
      findings.push({
        type: 'NO_WEB_PRESENCE',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${companyName} has no verifiable web presence`,
        description: `No working website could be found for ${companyName}. Legitimate operating companies typically maintain a web presence. This could indicate a shell company or dormant entity.`,
        evidence: website.flags.map((f) => `Flag: ${f}`),
        affectedEntities: [],
        recommendation: 'Verify the company operates from a physical address. Request evidence of business operations. Consider enhanced due diligence.',
      });
    }

    if (website.isParked) {
      findings.push({
        type: 'PARKED_WEBSITE',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `Company website appears to be a parked domain`,
        description: `The website at ${website.url} shows characteristics of a parked or placeholder page. This is inconsistent with an active business.`,
        evidence: ['Domain appears parked or for sale', ...website.flags.map((f) => `Flag: ${f}`)],
        affectedEntities: [],
        recommendation: 'Investigate why the company has no active website. This is a common shell company indicator.',
      });
    }

    if (website.flags.includes('DOMAIN_VERY_NEW')) {
      findings.push({
        type: 'NEW_DOMAIN',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `Company domain registered within the last 3 months`,
        description: `The domain for ${companyName} was registered very recently (${website.domainAge}). For established companies, this is unusual and may indicate a newly created entity.`,
        evidence: [`Domain registered: ${website.domainAge}`, `Registrar: ${website.domainRegistrar || 'Unknown'}`],
        affectedEntities: [],
        recommendation: 'Cross-reference domain age with company incorporation date. A new domain for an old company may indicate a rebrand or a fraudulent entity.',
      });
    }

    // Government contracts
    if (govContracts.length > 0) {
      const totalValue = govContracts.reduce((s, c) => s + c.amount, 0);
      findings.push({
        type: 'GOVERNMENT_CONTRACTOR',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${govContracts.length} US government contract${govContracts.length !== 1 ? 's' : ''} ($${(totalValue / 1e6).toFixed(1)}M)`,
        description: `${companyName} has ${govContracts.length} federal contract${govContracts.length !== 1 ? 's' : ''} totaling $${(totalValue / 1e6).toFixed(1)}M across agencies including ${[...new Set(govContracts.map((c) => c.agency))].slice(0, 3).join(', ')}. Government relationships indicate operational legitimacy but also subject the entity to FCPA and other anti-corruption requirements.`,
        evidence: govContracts.slice(0, 5).map((c) => `${c.agency}: $${(c.amount / 1e6).toFixed(1)}M — ${c.description?.slice(0, 80)}`),
        affectedEntities: [],
        recommendation: 'Verify compliance with FCPA and government contractor requirements. Government contracts indicate operational legitimacy.',
      });
    }

    // Court cases
    if (courtCases.length > 0) {
      findings.push({
        type: 'LITIGATION',
        severity: courtCases.length >= 5 ? 'HIGH' : 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${courtCases.length} federal court case${courtCases.length !== 1 ? 's' : ''} found`,
        description: `${companyName} appears in ${courtCases.length} federal court record${courtCases.length !== 1 ? 's' : ''} on CourtListener. Active or recent litigation may pose financial and reputational risk.`,
        evidence: courtCases.slice(0, 5).map((c) => `${c.dateFiled}: ${c.caseName} (${c.court})`),
        affectedEntities: [],
        recommendation: 'Review court filings to determine if the company is plaintiff or defendant. Assess potential financial liability and reputational impact.',
      });
    }

    return findings;
  }

  private emptyWebsiteCheck(): WebsiteCheck {
    return { url: null, exists: false, statusCode: null, domainAge: null, domainRegistrar: null, isParked: false, sslValid: false, flags: [] };
  }
}
