import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const DATA_BASE = 'https://data.sec.gov';
const SEC_BASE = 'https://www.sec.gov';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 130 - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

function padCik(cik: string | number): string {
  return String(cik).replace(/^0+/, '').padStart(10, '0');
}

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

// ─── 8-K Event Types ───
const MATERIAL_EVENT_ITEMS: Record<string, { label: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }> = {
  '1.01': { label: 'Entry into a Material Agreement', severity: 'LOW' },
  '1.02': { label: 'Termination of Material Agreement', severity: 'MEDIUM' },
  '1.03': { label: 'Bankruptcy or Receivership', severity: 'HIGH' },
  '2.01': { label: 'Acquisition or Disposition of Assets', severity: 'MEDIUM' },
  '2.02': { label: 'Results of Operations / Financial Condition', severity: 'LOW' },
  '2.04': { label: 'Triggering Events (Default)', severity: 'HIGH' },
  '2.05': { label: 'Costs for Exit or Disposal', severity: 'MEDIUM' },
  '2.06': { label: 'Material Impairments', severity: 'HIGH' },
  '3.01': { label: 'Delisting / Transfer Failure', severity: 'HIGH' },
  '4.01': { label: 'Change in Auditor', severity: 'MEDIUM' },
  '4.02': { label: 'Non-Reliance on Prior Financials', severity: 'HIGH' },
  '5.01': { label: 'Change in Control', severity: 'HIGH' },
  '5.02': { label: 'Departure/Appointment of Officers', severity: 'MEDIUM' },
  '5.03': { label: 'Amendments to Articles/Bylaws', severity: 'LOW' },
  '7.01': { label: 'Regulation FD Disclosure', severity: 'LOW' },
  '8.01': { label: 'Other Events', severity: 'LOW' },
};

export interface MaterialEvent {
  date: string;
  formType: string;
  items: string[];
  itemLabels: string[];
  accession: string;
  url: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface InsiderSignal {
  totalTransactions: number;
  buyCount: number;
  sellCount: number;
  netDirection: 'NET_BUYING' | 'NET_SELLING' | 'BALANCED';
  recentSellers: Array<{ name: string; cik: string; sellCount: number }>;
  recentBuyers: Array<{ name: string; cik: string; buyCount: number }>;
  signalStrength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
}

export interface RiskFactorSummary {
  totalRiskFactors: number;
  categories: Record<string, number>;
  topRisks: string[];
  litigationMentioned: boolean;
  regulatoryMentioned: boolean;
  cyberMentioned: boolean;
}

export interface FinancialRatios {
  revenue: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  profitMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  period: string | null;
  flags: string[];
}

/**
 * Deep SEC Intelligence Service.
 *
 * Extracts actionable intelligence from SEC EDGAR filings:
 * 1. 8-K Material Events — what's happening RIGHT NOW
 * 2. Insider Trading Signals — are insiders buying or selling?
 * 3. 10-K Risk Factors — self-disclosed risks
 * 4. Deep Financial Ratios — balance sheet health
 */
@Injectable()
export class SecIntelligenceService {
  private readonly logger = new Logger(SecIntelligenceService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  /**
   * Run all SEC intelligence checks and return findings.
   */
  async analyze(
    investigationId: string,
    cik: string,
    companyName: string,
  ): Promise<{
    events: MaterialEvent[];
    insiderSignal: InsiderSignal;
    riskFactors: RiskFactorSummary;
    financials: FinancialRatios;
    findings: Finding[];
  }> {
    this.logger.log(`SEC Intelligence: analyzing ${companyName} (CIK ${cik})`);

    const [events, insiderSignal, riskFactors, financials] = await Promise.all([
      this.getMaterialEvents(cik).catch((e) => { this.logger.warn(`8-K parse failed: ${e?.message}`); return [] as MaterialEvent[]; }),
      this.getInsiderSignals(cik).catch((e) => { this.logger.warn(`Insider signals failed: ${e?.message}`); return this.emptyInsiderSignal(); }),
      this.getRiskFactors(cik).catch((e) => { this.logger.warn(`Risk factors failed: ${e?.message}`); return this.emptyRiskFactors(); }),
      this.getFinancialRatios(cik).catch((e) => { this.logger.warn(`Financial ratios failed: ${e?.message}`); return this.emptyFinancials(); }),
    ]);

    const findings = this.generateFindings(companyName, events, insiderSignal, riskFactors, financials);

    // Update root node metadata with intelligence
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company', entityId: cik },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.secIntelligence = {
          materialEvents: events.length,
          highSeverityEvents: events.filter((e) => e.severity === 'HIGH').length,
          insiderSignal: insiderSignal.netDirection,
          insiderSignalStrength: insiderSignal.signalStrength,
          riskFactorCount: riskFactors.totalRiskFactors,
          litigationRisk: riskFactors.litigationMentioned,
          regulatoryRisk: riskFactors.regulatoryMentioned,
          cyberRisk: riskFactors.cyberMentioned,
          financials: {
            profitMargin: financials.profitMargin,
            debtToEquity: financials.debtToEquity,
            currentRatio: financials.currentRatio,
            flags: financials.flags,
          },
          analyzedAt: new Date().toISOString(),
        };
        await this.nodes.update(rootNode.id, { metadata: meta });
      }
    } catch {}

    this.logger.log(
      `SEC Intelligence complete: ${events.length} events, insider=${insiderSignal.netDirection}(${insiderSignal.signalStrength}), ` +
      `${riskFactors.totalRiskFactors} risk factors, ${financials.flags.length} financial flags, ${findings.length} findings`,
    );

    return { events, insiderSignal, riskFactors, financials, findings };
  }

  // ═══════════════════════════════════════════
  // 1. 8-K MATERIAL EVENTS
  // ═══════════════════════════════════════════

  private async getMaterialEvents(cik: string): Promise<MaterialEvent[]> {
    return cached(`sec-intel:8k:${cik}`, async () => {
      const res = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, { headers: HEADERS, timeout: 10000 }),
      );

      const filings = res.data?.filings?.recent || {};
      const forms = filings.form || [];
      const dates = filings.filingDate || [];
      const accessions = filings.accessionNumber || [];
      const items = filings.items || [];

      const events: MaterialEvent[] = [];
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      for (let i = 0; i < forms.length && events.length < 20; i++) {
        if (forms[i] !== '8-K' && forms[i] !== '8-K/A') continue;
        const date = dates[i];
        if (!date || new Date(date) < sixMonthsAgo) continue;

        const itemStr = items[i] || '';
        const itemList = itemStr.split(',').map((s: string) => s.trim()).filter(Boolean);
        const itemLabels = itemList
          .map((item: string) => MATERIAL_EVENT_ITEMS[item]?.label || item)
          .filter(Boolean);

        // Determine severity — highest among reported items
        let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
        for (const item of itemList) {
          const info = MATERIAL_EVENT_ITEMS[item];
          if (info?.severity === 'HIGH') severity = 'HIGH';
          else if (info?.severity === 'MEDIUM' && severity !== 'HIGH') severity = 'MEDIUM';
        }

        const accClean = (accessions[i] || '').replace(/-/g, '');
        events.push({
          date,
          formType: forms[i],
          items: itemList,
          itemLabels,
          accession: accessions[i],
          url: `${SEC_BASE}/Archives/edgar/data/${cik}/${accClean}/${accessions[i]}-index.htm`,
          severity,
        });
      }

      return events;
    });
  }

  // ═══════════════════════════════════════════
  // 2. INSIDER TRADING SIGNALS
  // ═══════════════════════════════════════════

  private async getInsiderSignals(cik: string): Promise<InsiderSignal> {
    return cached(`sec-intel:insider:${cik}`, async () => {
      const res = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, { headers: HEADERS, timeout: 10000 }),
      );

      const filings = res.data?.filings?.recent || {};
      const forms = filings.form || [];
      const dates = filings.filingDate || [];
      const accessions = filings.accessionNumber || [];

      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      // Collect Form 4 filers and their transactions
      const filerActivity = new Map<string, { buys: number; sells: number }>();
      const filerCiks: string[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < forms.length; i++) {
        if (forms[i] !== '4') continue;
        if (!dates[i] || new Date(dates[i]) < sixMonthsAgo) continue;
        const filerCik = accessions[i]?.split('-')[0]?.replace(/^0+/, '');
        if (!filerCik || filerCik === cik.replace(/^0+/, '') || seen.has(filerCik)) continue;
        seen.add(filerCik);
        filerCiks.push(filerCik);
        if (filerCiks.length >= 15) break;
      }

      // For each filer, parse a Form 4 to get buy/sell
      let totalBuys = 0;
      let totalSells = 0;
      const sellers: Array<{ name: string; cik: string; sellCount: number }> = [];
      const buyers: Array<{ name: string; cik: string; buyCount: number }> = [];

      for (const fCik of filerCiks.slice(0, 10)) {
        try {
          const fRes = await rl(() =>
            axios.get(`${DATA_BASE}/submissions/CIK${padCik(fCik)}.json`, { headers: HEADERS, timeout: 5000 }),
          );
          const name = fRes.data?.name || fCik;
          const fFilings = fRes.data?.filings?.recent || {};
          const fForms = fFilings.form || [];
          const fAccs = fFilings.accessionNumber || [];
          const fDates = fFilings.filingDate || [];

          let buys = 0;
          let sells = 0;

          // Count Form 4s for this company in the last 6 months
          for (let j = 0; j < Math.min(fForms.length, 50); j++) {
            if (fForms[j] !== '4') continue;
            if (!fDates[j] || new Date(fDates[j]) < sixMonthsAgo) continue;

            // Parse ONE Form 4 XML to check transaction type
            try {
              const acc = fAccs[j];
              const accClean = acc.replace(/-/g, '');
              const idxRes = await rl(() =>
                axios.get(`${SEC_BASE}/Archives/edgar/data/${fCik}/${accClean}/${acc}-index.htm`, {
                  headers: HEADERS, timeout: 5000, responseType: 'text',
                }),
              );
              const xmlMatch = (idxRes.data as string).match(/href="([^"]+\.xml)"/);
              if (!xmlMatch) continue;
              let xmlUrl = xmlMatch[1];
              if (!xmlUrl.startsWith('http')) xmlUrl = `${SEC_BASE}${xmlUrl.startsWith('/') ? '' : '/'}${xmlUrl}`;
              const xmlRes = await rl(() =>
                axios.get(xmlUrl, { headers: HEADERS, timeout: 5000, responseType: 'text' }),
              );
              const xml = xmlRes.data as string;
              const issuerCik = xml.match(/<issuerCik>([^<]+)/)?.[1]?.replace(/^0+/, '');
              if (issuerCik !== cik.replace(/^0+/, '')) continue;

              // Check transaction codes: P=Purchase, S=Sale, A=Award, M=Exercise
              const txCodes = [...xml.matchAll(/<transactionCode>([^<]+)/g)].map((m) => m[1]);
              for (const code of txCodes) {
                if (code === 'P') buys++;
                else if (code === 'S') sells++;
              }
              break; // One Form 4 per filer is enough for signal
            } catch { continue; }
          }

          totalBuys += buys;
          totalSells += sells;
          if (sells > 0) sellers.push({ name, cik: fCik, sellCount: sells });
          if (buys > 0) buyers.push({ name, cik: fCik, buyCount: buys });

          if (!filerActivity.has(fCik)) filerActivity.set(fCik, { buys: 0, sells: 0 });
          const act = filerActivity.get(fCik)!;
          act.buys += buys;
          act.sells += sells;
        } catch { continue; }
      }

      const total = totalBuys + totalSells;
      let netDirection: InsiderSignal['netDirection'] = 'BALANCED';
      if (totalSells > totalBuys * 2) netDirection = 'NET_SELLING';
      else if (totalBuys > totalSells * 2) netDirection = 'NET_BUYING';

      let signalStrength: InsiderSignal['signalStrength'] = 'NONE';
      if (total >= 10) signalStrength = sellers.length >= 5 ? 'STRONG' : 'MODERATE';
      else if (total >= 3) signalStrength = 'WEAK';

      return {
        totalTransactions: total,
        buyCount: totalBuys,
        sellCount: totalSells,
        netDirection,
        recentSellers: sellers.sort((a, b) => b.sellCount - a.sellCount).slice(0, 5),
        recentBuyers: buyers.sort((a, b) => b.buyCount - a.buyCount).slice(0, 5),
        signalStrength,
      };
    });
  }

  // ═══════════════════════════════════════════
  // 3. 10-K RISK FACTORS
  // ═══════════════════════════════════════════

  private async getRiskFactors(cik: string): Promise<RiskFactorSummary> {
    return cached(`sec-intel:risk:${cik}`, async () => {
      const res = await rl(() =>
        axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, { headers: HEADERS, timeout: 10000 }),
      );

      const filings = res.data?.filings?.recent || {};
      const forms = filings.form || [];
      const accessions = filings.accessionNumber || [];
      const primaryDocs = filings.primaryDocument || [];

      // Find latest 10-K
      let accession: string | null = null;
      let doc: string | null = null;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] === '10-K' || forms[i] === '10-K/A') {
          accession = accessions[i];
          doc = primaryDocs[i];
          break;
        }
      }
      if (!accession || !doc) return this.emptyRiskFactors();

      const accClean = accession.replace(/-/g, '');
      const url = `${SEC_BASE}/Archives/edgar/data/${cik}/${accClean}/${doc}`;

      const htmlRes = await rl(() =>
        axios.get(url, { headers: HEADERS, timeout: 30000, responseType: 'text' }),
      );
      const html = htmlRes.data as string;

      // Extract text around "Risk Factors" section
      const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ');

      // Find "Item 1A" or "Risk Factors" section
      const riskStart = text.search(/Item\s*1A[\.\s]*Risk\s*Factors/i);
      if (riskStart === -1) return this.emptyRiskFactors();

      // Extract ~15000 chars of risk factors text
      const riskText = text.slice(riskStart, riskStart + 15000).toLowerCase();

      // Categorize risks
      const categories: Record<string, number> = {};
      const riskPatterns: Record<string, RegExp> = {
        litigation: /\b(lawsuit|litigation|legal proceedings?|plaintiff|defendant|court|arbitration|class action)\b/g,
        regulatory: /\b(regulat|compliance|enforcement|SEC |FTC |DOJ |antitrust|GDPR|CCPA|consent decree)\b/g,
        cybersecurity: /\b(cyber|data breach|ransomware|phishing|information security|unauthorized access|privacy)\b/g,
        financial: /\b(debt|leverage|credit|liquidity|impairment|goodwill|write-?down|covenant)\b/g,
        operational: /\b(supply chain|disruption|key personnel|depend|single source|concentration)\b/g,
        competitive: /\b(competition|competitive|market share|pricing pressure|new entrant)\b/g,
        geopolitical: /\b(geopolitical|trade war|tariff|sanction|embargo|political instabilit|conflict)\b/g,
        environmental: /\b(environmental|climate|carbon|emission|pollution|sustainability|ESG)\b/g,
      };

      for (const [category, pattern] of Object.entries(riskPatterns)) {
        const matches = riskText.match(pattern);
        if (matches && matches.length > 0) categories[category] = matches.length;
      }

      // Extract top risk factor headings
      const headingPattern = /(?:^|\n)\s*([A-Z][A-Za-z\s,\-]{10,80}(?:\.|\n))/g;
      const topRisks: string[] = [];
      const fullText = text.slice(riskStart, riskStart + 30000);
      let headingMatch;
      while ((headingMatch = headingPattern.exec(fullText)) !== null && topRisks.length < 10) {
        const heading = headingMatch[1].trim().replace(/\.$/, '');
        if (heading.length > 15 && heading.length < 120 && !heading.includes('Table of Contents')) {
          topRisks.push(heading);
        }
      }

      return {
        totalRiskFactors: topRisks.length,
        categories,
        topRisks: topRisks.slice(0, 8),
        litigationMentioned: (categories.litigation || 0) > 0,
        regulatoryMentioned: (categories.regulatory || 0) > 0,
        cyberMentioned: (categories.cybersecurity || 0) > 0,
      };
    });
  }

  // ═══════════════════════════════════════════
  // 4. DEEP FINANCIAL RATIOS
  // ═══════════════════════════════════════════

  private async getFinancialRatios(cik: string): Promise<FinancialRatios> {
    return cached(`sec-intel:fin:${cik}`, async () => {
      const res = await rl(() =>
        axios.get(`${DATA_BASE}/api/xbrl/companyfacts/CIK${padCik(cik)}.json`, { headers: HEADERS, timeout: 15000 }),
      );

      const facts = res.data?.facts?.['us-gaap'] || {};
      const getLatest10K = (concept: string): number | null => {
        const data = facts[concept]?.units?.USD;
        if (!data) return null;
        const sorted = data.filter((v: any) => v.form === '10-K').sort((a: any, b: any) => (b.end || '').localeCompare(a.end || ''));
        return sorted[0]?.val ?? null;
      };

      const getLatest10KPure = (concept: string): number | null => {
        const data = facts[concept]?.units?.pure || facts[concept]?.units?.USD;
        if (!data) return null;
        const sorted = data.filter((v: any) => v.form === '10-K').sort((a: any, b: any) => (b.end || '').localeCompare(a.end || ''));
        return sorted[0]?.val ?? null;
      };

      const revenue = getLatest10K('Revenues') || getLatest10K('RevenueFromContractWithCustomerExcludingAssessedTax') || getLatest10K('SalesRevenueNet');
      const netIncome = getLatest10K('NetIncomeLoss');
      const totalAssets = getLatest10K('Assets');
      const totalLiabilities = getLatest10K('Liabilities');
      const totalEquity = getLatest10K('StockholdersEquity') || getLatest10K('StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest');
      const currentAssets = getLatest10K('AssetsCurrent');
      const currentLiabilities = getLatest10K('LiabilitiesCurrent');
      const cash = getLatest10K('CashAndCashEquivalentsAtCarryingValue') || getLatest10K('CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents');

      const profitMargin = revenue && netIncome ? Math.round((netIncome / revenue) * 1000) / 10 : null;
      const debtToEquity = totalLiabilities && totalEquity && totalEquity > 0 ? Math.round((totalLiabilities / totalEquity) * 100) / 100 : null;
      const currentRatio = currentAssets && currentLiabilities && currentLiabilities > 0 ? Math.round((currentAssets / currentLiabilities) * 100) / 100 : null;

      // Get period
      const revData = facts['Revenues']?.units?.USD || facts['RevenueFromContractWithCustomerExcludingAssessedTax']?.units?.USD || [];
      const latestPeriod = revData.filter((v: any) => v.form === '10-K').sort((a: any, b: any) => (b.end || '').localeCompare(a.end || ''))[0]?.end || null;

      // Financial health flags
      const flags: string[] = [];
      if (profitMargin !== null && profitMargin < 0) flags.push('NEGATIVE_PROFIT_MARGIN');
      if (profitMargin !== null && profitMargin < 2) flags.push('THIN_MARGINS');
      if (debtToEquity !== null && debtToEquity > 3) flags.push('HIGH_LEVERAGE');
      if (debtToEquity !== null && debtToEquity < 0) flags.push('NEGATIVE_EQUITY');
      if (currentRatio !== null && currentRatio < 1) flags.push('LOW_LIQUIDITY');
      if (netIncome !== null && netIncome < 0) flags.push('NET_LOSS');
      if (totalEquity !== null && totalEquity < 0) flags.push('NEGATIVE_SHAREHOLDERS_EQUITY');

      return { revenue, netIncome, totalAssets, totalLiabilities, totalEquity, currentAssets, currentLiabilities, cash, profitMargin, debtToEquity, currentRatio, period: latestPeriod, flags };
    });
  }

  // ═══════════════════════════════════════════
  // FINDINGS GENERATION
  // ═══════════════════════════════════════════

  private generateFindings(
    companyName: string,
    events: MaterialEvent[],
    insider: InsiderSignal,
    risks: RiskFactorSummary,
    financials: FinancialRatios,
  ): Finding[] {
    const findings: Finding[] = [];

    // 8-K Material Events
    const highEvents = events.filter((e) => e.severity === 'HIGH');
    if (highEvents.length > 0) {
      findings.push({
        type: 'MATERIAL_EVENT',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${highEvents.length} critical material event${highEvents.length !== 1 ? 's' : ''} in last 6 months`,
        description: `${companyName} filed ${highEvents.length} 8-K reports with high-severity items: ${highEvents.map((e) => e.itemLabels.join(', ')).join('; ')}. These indicate significant corporate changes that may affect risk assessment.`,
        evidence: highEvents.map((e) => `${e.date}: ${e.itemLabels.join(', ')}`),
        affectedEntities: [],
        recommendation: 'Review the specific 8-K filings to understand the nature and impact of these material events on business operations and risk profile.',
      });
    }

    const medEvents = events.filter((e) => e.severity === 'MEDIUM');
    if (medEvents.length > 0) {
      findings.push({
        type: 'MATERIAL_EVENT',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${medEvents.length} notable corporate event${medEvents.length !== 1 ? 's' : ''} in last 6 months`,
        description: `${companyName} reported ${medEvents.length} medium-severity events including: ${[...new Set(medEvents.flatMap((e) => e.itemLabels))].join(', ')}.`,
        evidence: medEvents.slice(0, 5).map((e) => `${e.date}: ${e.itemLabels.join(', ')}`),
        affectedEntities: [],
        recommendation: 'Monitor these events for potential escalation. Verify officer changes and audit modifications.',
      });
    }

    // Insider Trading Signal
    if (insider.netDirection === 'NET_SELLING' && insider.signalStrength !== 'NONE') {
      findings.push({
        type: 'INSIDER_SELLING',
        severity: insider.signalStrength === 'STRONG' ? 'HIGH' : 'MEDIUM',
        confidence: insider.signalStrength === 'STRONG' ? 'HIGH' : 'MEDIUM',
        title: `Net insider selling detected (${insider.sellCount} sells vs ${insider.buyCount} buys)`,
        description: `Insiders at ${companyName} have been net sellers over the past 6 months. ${insider.recentSellers.length} insider${insider.recentSellers.length !== 1 ? 's' : ''} sold shares: ${insider.recentSellers.map((s) => s.name).join(', ')}. This may indicate declining insider confidence.`,
        evidence: [
          `Total transactions: ${insider.totalTransactions}`,
          `Buy transactions: ${insider.buyCount}`,
          `Sell transactions: ${insider.sellCount}`,
          ...insider.recentSellers.map((s) => `${s.name}: ${s.sellCount} sell transaction(s)`),
        ],
        affectedEntities: [],
        recommendation: 'Evaluate whether insider selling is routine (e.g., 10b5-1 plans) or signals internal concerns. Compare with industry peers.',
      });
    }

    // Risk Factors
    if (risks.litigationMentioned || risks.regulatoryMentioned || risks.cyberMentioned) {
      const riskTypes = [
        risks.litigationMentioned && 'litigation/legal proceedings',
        risks.regulatoryMentioned && 'regulatory compliance',
        risks.cyberMentioned && 'cybersecurity/data privacy',
      ].filter(Boolean);
      findings.push({
        type: 'SELF_DISCLOSED_RISK',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `Company self-discloses ${riskTypes.join(', ')} risks`,
        description: `${companyName}'s 10-K filing identifies ${risks.totalRiskFactors} risk factors with significant mentions of ${riskTypes.join(' and ')}. These are self-acknowledged areas of concern.`,
        evidence: [
          `Risk categories: ${Object.entries(risks.categories).map(([k, v]) => `${k}(${v})`).join(', ')}`,
          ...risks.topRisks.slice(0, 3).map((r) => `Risk factor: "${r}"`),
        ],
        affectedEntities: [],
        recommendation: 'Cross-reference self-disclosed risks with adverse media and court records. Self-disclosed litigation may indicate pending or active cases.',
      });
    }

    // Financial Distress Signals
    for (const flag of financials.flags) {
      if (flag === 'NEGATIVE_EQUITY' || flag === 'NEGATIVE_SHAREHOLDERS_EQUITY') {
        findings.push({
          type: 'FINANCIAL_DISTRESS',
          severity: 'HIGH',
          confidence: 'HIGH',
          title: `${companyName} has negative shareholders equity`,
          description: `The company's total liabilities exceed total assets, resulting in negative equity. This may indicate severe financial distress or aggressive leveraging.`,
          evidence: [`Total equity: $${((financials.totalEquity || 0) / 1e9).toFixed(1)}B`, `Debt-to-equity: ${financials.debtToEquity}`],
          affectedEntities: [],
          recommendation: 'Assess the company\'s ability to meet obligations. Review credit ratings and debt covenants.',
        });
      }
      if (flag === 'HIGH_LEVERAGE') {
        findings.push({
          type: 'FINANCIAL_DISTRESS',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          title: `High leverage: debt-to-equity ratio of ${financials.debtToEquity}`,
          description: `${companyName}'s debt-to-equity ratio of ${financials.debtToEquity} exceeds 3.0, indicating significant leverage. This increases vulnerability to economic downturns.`,
          evidence: [`Debt-to-equity: ${financials.debtToEquity}`, `Total liabilities: $${((financials.totalLiabilities || 0) / 1e9).toFixed(1)}B`],
          affectedEntities: [],
          recommendation: 'Compare leverage with industry peers. Review debt maturity schedule and interest coverage.',
        });
      }
      if (flag === 'LOW_LIQUIDITY') {
        findings.push({
          type: 'FINANCIAL_DISTRESS',
          severity: 'MEDIUM',
          confidence: 'HIGH',
          title: `Low liquidity: current ratio of ${financials.currentRatio}`,
          description: `${companyName}'s current ratio is below 1.0, meaning current liabilities exceed current assets. Short-term payment ability may be at risk.`,
          evidence: [`Current ratio: ${financials.currentRatio}`, `Current assets: $${((financials.currentAssets || 0) / 1e9).toFixed(1)}B`],
          affectedEntities: [],
          recommendation: 'Review cash flow statement and upcoming debt maturities. Assess whether the company can meet near-term obligations.',
        });
      }
    }

    return findings;
  }

  private emptyInsiderSignal(): InsiderSignal {
    return { totalTransactions: 0, buyCount: 0, sellCount: 0, netDirection: 'BALANCED', recentSellers: [], recentBuyers: [], signalStrength: 'NONE' };
  }

  private emptyRiskFactors(): RiskFactorSummary {
    return { totalRiskFactors: 0, categories: {}, topRisks: [], litigationMentioned: false, regulatoryMentioned: false, cyberMentioned: false };
  }

  private emptyFinancials(): FinancialRatios {
    return { revenue: null, netIncome: null, totalAssets: null, totalLiabilities: null, totalEquity: null, currentAssets: null, currentLiabilities: null, cash: null, profitMargin: null, debtToEquity: null, currentRatio: null, period: null, flags: [] };
  }
}
