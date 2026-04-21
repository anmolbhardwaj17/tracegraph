import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';
import {
  EnrichedPerson, EnrichedLocation, EnrichedSubsidiary,
} from './enrichment.interface';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const NSE_BASE = 'https://www.nseindia.com/api';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 500 - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

// NSE requires cookies from initial page visit
let nseCookies = '';
async function ensureNseCookies(): Promise<void> {
  if (nseCookies) return;
  try {
    const res = await axios.get('https://www.nseindia.com', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
      maxRedirects: 3,
    });
    const cookies = res.headers['set-cookie'] || [];
    nseCookies = cookies.map((c: string) => c.split(';')[0]).join('; ');
  } catch {}
}

function nseHeaders(): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    Referer: 'https://www.nseindia.com',
    ...(nseCookies ? { Cookie: nseCookies } : {}),
  };
}

export interface NseCompanyData {
  symbol: string;
  name: string;
  industry: string | null;
  isin: string | null;
  listingDate: string | null;
  price: number | null;
  // Shareholding
  promoterHolding: number | null;
  publicHolding: number | null;
  // Financials
  revenue: number | null;
  profit: number | null;
  eps: number | null;
  // Announcements
  announcements: Array<{ date: string; subject: string }>;
  // Board meetings
  boardMeetings: Array<{ date: string; purpose: string }>;
  // Corporate actions
  corporateActions: Array<{ date: string; purpose: string }>;
}

export interface IndianCourtCase {
  docId: string;
  title: string;
  court: string;
  url: string;
}

/**
 * India-Specific Intelligence Service.
 *
 * Deep data for Indian companies from:
 * 1. NSE India — stock data, shareholding (UBO), financials, announcements, board meetings
 * 2. Indian Kanoon — court case search (India's largest free legal database)
 * 3. Zaubacorp — company profile, directors, CIN lookup
 *
 * For listed companies, this provides investigation depth comparable to SEC EDGAR for US.
 */
@Injectable()
export class IndiaIntelligenceService {
  private readonly logger = new Logger(IndiaIntelligenceService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async analyze(
    investigationId: string,
    companyName: string,
  ): Promise<{
    nseData: NseCompanyData | null;
    courtCases: IndianCourtCase[];
    people: EnrichedPerson[];
    findings: Finding[];
  }> {
    this.logger.log(`India Intelligence: analyzing ${companyName}`);

    // Step 1: Search NSE for the company
    const nseData = await this.getNseData(companyName);

    // Step 2: Search Indian Kanoon for court cases
    const courtCases = await this.searchIndianKanoon(companyName);

    // Step 3: Generate findings
    const findings = this.generateFindings(companyName, nseData, courtCases);

    // Step 4: Update root node with NSE data
    if (nseData) {
      try {
        const rootNode = await this.nodes.findOne({
          where: { investigationId, entityType: 'company' },
          order: { id: 'ASC' },
        });
        if (rootNode) {
          const meta = (rootNode.metadata || {}) as any;
          meta.nseData = {
            symbol: nseData.symbol,
            industry: nseData.industry,
            isin: nseData.isin,
            listingDate: nseData.listingDate,
            price: nseData.price,
            promoterHolding: nseData.promoterHolding,
            publicHolding: nseData.publicHolding,
            revenue: nseData.revenue,
            profit: nseData.profit,
            eps: nseData.eps,
            isListed: true,
          };
          if (nseData.revenue) {
            const revCrore = nseData.revenue;
            if (revCrore > 10000) meta.revenue = `₹${(revCrore / 100).toFixed(0)}B`;
            else meta.revenue = `₹${revCrore.toLocaleString()} Cr`;
          }
          if (nseData.industry) meta.industry = nseData.industry;
          meta.enriched = true;
          await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});
        }
      } catch {}
    }

    this.logger.log(
      `India Intelligence complete: NSE=${nseData ? 'found' : 'not listed'}, ` +
      `courts=${courtCases.length}, findings=${findings.length}`,
    );

    // Step 4: Build shareholding ownership graph for listed companies
    if (nseData?.promoterHolding != null) {
      try {
        await this.buildShareholdingGraph(investigationId, companyName, nseData);
      } catch (e: any) {
        this.logger.warn(`Shareholding graph failed: ${e?.message}`);
      }
    }

    return { nseData, courtCases, people: [], findings };
  }

  /** Build ownership graph nodes from NSE shareholding pattern */
  private async buildShareholdingGraph(
    investigationId: string,
    companyName: string,
    nseData: NseCompanyData,
  ): Promise<void> {
    const rootNode = await this.nodes.findOne({
      where: { investigationId, entityType: 'company' },
      order: { id: 'ASC' },
    });
    if (!rootNode) return;

    // Create ownership nodes for promoter group
    if (nseData.promoterHolding && nseData.promoterHolding > 0) {
      const promoterNode = await this.nodes.save(this.nodes.create({
        investigationId,
        entityType: 'company',
        entityId: `nse-promoter-${nseData.symbol}`,
        label: `${companyName} — Promoter Group`,
        metadata: {
          isOwner: true,
          ownershipPct: nseData.promoterHolding,
          ownershipType: 'promoter',
          dataSource: 'nse-india',
        },
      } as any)).catch(() => null);

      if (promoterNode) {
        await this.nodes.query(
          `INSERT INTO graph_edges ("investigationId", "sourceNodeId", "targetNodeId", "relationshipType", metadata) VALUES ($1, $2, $3, 'psc', $4) ON CONFLICT DO NOTHING`,
          [investigationId, (promoterNode as any).id, rootNode.id, JSON.stringify({ type: 'promoter-holding', ownershipPct: nseData.promoterHolding })],
        ).catch(() => {});
      }
    }

    // Create node for public holding
    if (nseData.publicHolding && nseData.publicHolding > 0) {
      const publicNode = await this.nodes.save(this.nodes.create({
        investigationId,
        entityType: 'company',
        entityId: `nse-public-${nseData.symbol}`,
        label: `Public Shareholders`,
        metadata: {
          isOwner: true,
          ownershipPct: nseData.publicHolding,
          ownershipType: 'public',
          dataSource: 'nse-india',
        },
      } as any)).catch(() => null);

      if (publicNode) {
        await this.nodes.query(
          `INSERT INTO graph_edges ("investigationId", "sourceNodeId", "targetNodeId", "relationshipType", metadata) VALUES ($1, $2, $3, 'psc', $4) ON CONFLICT DO NOTHING`,
          [investigationId, (publicNode as any).id, rootNode.id, JSON.stringify({ type: 'public-holding', ownershipPct: nseData.publicHolding })],
        ).catch(() => {});
      }
    }

    this.logger.log(`Shareholding graph built for ${nseData.symbol}: promoter ${nseData.promoterHolding}%, public ${nseData.publicHolding}%`);
  }

  // ═══════════════════════════════════════════
  // NSE DATA
  // ═══════════════════════════════════════════

  private async getNseData(companyName: string): Promise<NseCompanyData | null> {
    return cached(`india-nse:${companyName.toLowerCase()}`, async () => {
      await ensureNseCookies();

      // Step 1: Search for the symbol
      const searchName = companyName
        .replace(/\b(LIMITED|LTD|PVT|PRIVATE|PUBLIC)\b\.?/gi, '')
        .trim();

      try {
        const searchRes = await rl(() =>
          axios.get(`${NSE_BASE}/search/autocomplete?q=${encodeURIComponent(searchName)}`, {
            headers: nseHeaders(),
            timeout: 10000,
          }),
        );

        const symbols = searchRes.data?.symbols || [];
        const equitySymbol = symbols.find((s: any) =>
          s.result_type === 'symbol' && s.result_sub_type === 'equity',
        );
        if (!equitySymbol) return null;

        const symbol = equitySymbol.symbol;
        this.logger.log(`NSE: found symbol ${symbol} for "${companyName}"`);

        // Step 2: Get quote data
        const [quoteRes, corpRes] = await Promise.all([
          rl(() => axios.get(`${NSE_BASE}/quote-equity?symbol=${symbol}`, { headers: nseHeaders(), timeout: 10000 })).catch(() => null),
          rl(() => axios.get(`${NSE_BASE}/top-corp-info?symbol=${symbol}&market=equities`, { headers: nseHeaders(), timeout: 10000 })).catch(() => null),
        ]);

        const quote = quoteRes?.data || {};
        const corp = corpRes?.data || {};

        // Parse shareholding
        const shPatterns = corp.shareholdings_patterns?.data || {};
        const latestSh = Object.values(shPatterns)[Object.keys(shPatterns).length - 1] as any[] || [];
        let promoterHolding: number | null = null;
        let publicHolding: number | null = null;
        for (const entry of latestSh) {
          const key = Object.keys(entry)[0];
          const val = parseFloat(entry[key]);
          if (key?.includes('Promoter')) promoterHolding = val;
          if (key?.includes('Public')) publicHolding = val;
        }

        // Parse financial results
        const finResults = corp.financial_results?.data || [];
        const latestFin = finResults[0] || {};

        // Parse announcements
        const announcements = (corp.latest_announcements?.data || []).slice(0, 10).map((a: any) => ({
          date: a.broadcastdate || '',
          subject: a.subject || '',
        }));

        // Parse board meetings
        const boardMeetings = (corp.borad_meeting?.data || []).slice(0, 5).map((m: any) => ({
          date: m.meetingdate || '',
          purpose: m.purpose?.slice(0, 200) || '',
        }));

        // Parse corporate actions
        const corporateActions = (corp.corporate_actions?.data || []).slice(0, 5).map((a: any) => ({
          date: a.exdate || '',
          purpose: a.purpose || '',
        }));

        return {
          symbol,
          name: quote.info?.companyName || companyName,
          industry: quote.metadata?.industry || null,
          isin: quote.metadata?.isin || null,
          listingDate: equitySymbol.listing_date || quote.metadata?.listingDate || null,
          price: quote.priceInfo?.lastPrice || null,
          promoterHolding,
          publicHolding,
          revenue: latestFin.income ? parseInt(latestFin.income, 10) : null,
          profit: latestFin.proLossAftTax ? parseInt(latestFin.proLossAftTax, 10) : null,
          eps: latestFin.reDilEPS ? parseFloat(latestFin.reDilEPS) : null,
          announcements,
          boardMeetings,
          corporateActions,
        };
      } catch (e: any) {
        this.logger.warn(`NSE data failed for "${companyName}": ${e?.message}`);
        return null;
      }
    });
  }

  // ═══════════════════════════════════════════
  // INDIAN KANOON COURT CASES
  // ═══════════════════════════════════════════

  private async searchIndianKanoon(companyName: string): Promise<IndianCourtCase[]> {
    const searchName = companyName
      .replace(/\b(LIMITED|LTD|PVT|PRIVATE|PUBLIC)\b\.?/gi, '')
      .trim();

    return cached(`india-kanoon:${searchName.toLowerCase()}`, async () => {
      try {
        const res = await rl(() =>
          axios.get(`https://indiankanoon.org/search/`, {
            params: { formInput: searchName },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000,
            responseType: 'text',
          }),
        );

        const html = res.data as string;
        const cases: IndianCourtCase[] = [];

        // Extract doc IDs and surrounding text
        const docPattern = /href="\/doc(?:fragment)?\/(\d+)\/?(?:\?[^"]*)?"/g;
        const docIds = new Set<string>();
        let match;
        while ((match = docPattern.exec(html)) !== null) {
          docIds.add(match[1]);
        }

        // For each unique doc, try to extract the case title from context
        const text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 10);

        // Look for case name patterns: "X vs Y" or "X v. Y"
        const caseNamePattern = /([A-Z][a-zA-Z\s,.']+(?:\bvs?\b\.?\s+)[A-Z][a-zA-Z\s,.']+)/g;
        const caseNames: string[] = [];
        let caseMatch;
        while ((caseMatch = caseNamePattern.exec(text)) !== null && caseNames.length < 10) {
          const name = caseMatch[1].trim();
          if (name.length > 10 && name.length < 150 && !caseNames.includes(name)) {
            caseNames.push(name);
          }
        }

        // Also extract court names
        const courtPattern = /(?:Supreme Court|High Court|Tribunal|NCLAT|NCLT|SAT|ITAT|CCI|SEBI)/gi;
        const courts: string[] = [];
        let courtMatch;
        while ((courtMatch = courtPattern.exec(text)) !== null && courts.length < 10) {
          if (!courts.includes(courtMatch[0])) courts.push(courtMatch[0]);
        }

        // Build case list
        const docIdArr = [...docIds].slice(0, 10);
        for (let i = 0; i < docIdArr.length; i++) {
          cases.push({
            docId: docIdArr[i],
            title: caseNames[i] || `Case ${docIdArr[i]}`,
            court: courts[i] || 'Indian Court',
            url: `https://indiankanoon.org/doc/${docIdArr[i]}/`,
          });
        }

        return cases;
      } catch (e: any) {
        this.logger.warn(`Indian Kanoon search failed: ${e?.message}`);
        return [];
      }
    });
  }

  // ═══════════════════════════════════════════
  // FINDINGS
  // ═══════════════════════════════════════════

  private generateFindings(
    companyName: string,
    nse: NseCompanyData | null,
    courtCases: IndianCourtCase[],
  ): Finding[] {
    const findings: Finding[] = [];

    // NSE-based findings
    if (nse) {
      // Shareholding pattern analysis
      if (nse.promoterHolding != null) {
        if (nse.promoterHolding < 25) {
          findings.push({
            type: 'LOW_PROMOTER_HOLDING',
            severity: 'MEDIUM',
            confidence: 'HIGH',
            title: `Low promoter holding: ${nse.promoterHolding}%`,
            description: `${companyName} has only ${nse.promoterHolding}% promoter holding (public: ${nse.publicHolding}%). Low promoter stake may indicate reduced founder commitment or potential takeover vulnerability.`,
            evidence: [`Promoter holding: ${nse.promoterHolding}%`, `Public holding: ${nse.publicHolding}%`, `Source: NSE India`],
            affectedEntities: [],
            recommendation: 'Review shareholding trend — declining promoter holding warrants attention. Check for pledge of promoter shares.',
          });
        }

        // Report shareholding as informational
        findings.push({
          type: 'SHAREHOLDING_PATTERN',
          severity: 'LOW',
          confidence: 'HIGH',
          title: `Shareholding: ${nse.promoterHolding}% promoter, ${nse.publicHolding}% public`,
          description: `${companyName} (NSE: ${nse.symbol}) is a listed company with ${nse.promoterHolding}% promoter holding and ${nse.publicHolding}% public holding. Listed on ${nse.listingDate || 'N/A'}, current price ₹${nse.price || '?'}.`,
          evidence: [
            `NSE Symbol: ${nse.symbol}`,
            `ISIN: ${nse.isin || 'N/A'}`,
            `Industry: ${nse.industry || 'N/A'}`,
            `Listing date: ${nse.listingDate || 'N/A'}`,
            nse.revenue ? `Revenue: ₹${nse.revenue.toLocaleString()} Lakhs` : '',
            nse.profit ? `Profit after tax: ₹${nse.profit.toLocaleString()} Lakhs` : '',
          ].filter(Boolean),
          affectedEntities: [],
          recommendation: 'Listed company data verified via NSE India.',
        });
      }

      // Corporate announcements — check for concerning items
      const concerningAnnouncements = nse.announcements.filter((a) => {
        const subj = a.subject.toLowerCase();
        return subj.includes('action') || subj.includes('order') || subj.includes('penalty') ||
               subj.includes('fraud') || subj.includes('investigation') || subj.includes('sebi') ||
               subj.includes('disposal') || subj.includes('litigation');
      });
      if (concerningAnnouncements.length > 0) {
        findings.push({
          type: 'INDIA_CORP_ANNOUNCEMENT',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          title: `${concerningAnnouncements.length} notable corporate announcement${concerningAnnouncements.length !== 1 ? 's' : ''}`,
          description: `${companyName} has ${concerningAnnouncements.length} corporate announcement${concerningAnnouncements.length !== 1 ? 's' : ''} that may indicate regulatory actions, disposals, or litigation.`,
          evidence: concerningAnnouncements.map((a) => `${a.date}: ${a.subject}`),
          affectedEntities: [],
          recommendation: 'Review NSE corporate announcements for details on regulatory actions or material events.',
        });
      }
    } else {
      // Not listed — flag this
      findings.push({
        type: 'NOT_LISTED_INDIA',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${companyName} is not listed on NSE`,
        description: `No NSE listing found for "${companyName}". The company is either a private company, listed only on BSE, or uses a different registered name. Limited financial transparency for unlisted Indian companies.`,
        evidence: ['NSE search returned no equity match'],
        affectedEntities: [],
        recommendation: 'For unlisted Indian companies, request audited financial statements directly. Consider MCA filings for compliance history.',
      });
    }

    // Court cases
    if (courtCases.length > 0) {
      findings.push({
        type: 'INDIA_COURT_CASES',
        severity: courtCases.length >= 5 ? 'HIGH' : 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${courtCases.length} Indian court case${courtCases.length !== 1 ? 's' : ''} found`,
        description: `${companyName} appears in ${courtCases.length} case${courtCases.length !== 1 ? 's' : ''} on Indian Kanoon (India's legal database). Courts include: ${[...new Set(courtCases.map((c) => c.court))].join(', ')}.`,
        evidence: courtCases.slice(0, 5).map((c) => `${c.title.slice(0, 80)} (${c.court})`),
        affectedEntities: [],
        recommendation: 'Review court cases to determine if the company is plaintiff or defendant. NCLT/NCLAT cases may indicate insolvency proceedings.',
      });
    }

    return findings;
  }
}
