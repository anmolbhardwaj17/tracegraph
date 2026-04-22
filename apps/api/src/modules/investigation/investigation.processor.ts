import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import axios from 'axios';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investigation } from './entities/investigation.entity';
import { GraphExpansionService } from '../graph/graph-expansion.service';
import { AddressService } from '../graph/address.service';
import { EntityResolutionService } from '../entity-resolution/entity-resolution.service';
import { SanctionsProximityService } from '../entity-resolution/proximity.service';
import { RiskScoringService } from '../risk-scoring/risk-scoring.service';
import { CompaniesHouseService } from '../companies-house/companies-house.service';
import { UboChainService } from '../ubo-chain/ubo-chain.service';
import { EnrichmentService } from '../enrichment/enrichment.service';
import { PepDetectionService } from '../enrichment/pep-detection.service';
import { AdverseMediaService } from '../enrichment/adverse-media.service';
import { AiNarrativeService } from '../enrichment/ai-narrative.service';
import { SecIntelligenceService } from '../enrichment/sec-intelligence.service';
import { WebIntelligenceService } from '../enrichment/web-intelligence.service';
import { SanctionsDirectService } from '../enrichment/sanctions-direct.service';
import { AddressVerificationService } from '../enrichment/address-verification.service';
import { WaybackService } from '../enrichment/wayback.service';
import { PoliticalDonationsService } from '../enrichment/political-donations.service';
import { RegulatoryViolationsService } from '../enrichment/regulatory-violations.service';
import { CfpbComplaintsService } from '../enrichment/cfpb-complaints.service';
import { FatfJurisdictionService } from '../enrichment/fatf-jurisdiction.service';
import { PatentSearchService } from '../enrichment/patent-search.service';
import { NonprofitLookupService } from '../enrichment/nonprofit-lookup.service';
import { LinkedInIntelligenceService } from '../enrichment/linkedin-intelligence.service';
import { IndiaIntelligenceService } from '../enrichment/india-intelligence.service';
import { IndiaSearchService } from '../india/india-search.service';
import { EntityMergeService } from '../intelligence/entity-merge.service';
import { GraphAnalyticsService } from '../intelligence/graph-analytics.service';
import { TemporalAnalysisService as TemporalIntelService } from '../intelligence/temporal-analysis.service';
import { PeerComparisonService } from '../intelligence/peer-comparison.service';
import { FilingNlpService } from '../intelligence/filing-nlp.service';
import { ProactiveCrawlerService } from '../intelligence/proactive-crawler.service';
import { InvestigationGateway } from './investigation.gateway';
import { GleifProvider } from '../jurisdictions/providers/gleif.provider';
import { SecEdgarProvider } from '../jurisdictions/providers/sec-edgar.provider';
import { IndiaMcaProvider } from '../jurisdictions/providers/india-mca.provider';
import { FranceSireneProvider } from '../jurisdictions/providers/france-sirene.provider';
import { GermanyNorthdataProvider } from '../jurisdictions/providers/germany-northdata.provider';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import * as SecNet from '../jurisdictions/providers/sec-network.service';

export const INVESTIGATION_QUEUE = 'investigation';

export interface InvestigationJobData {
  investigationId: string;
  query: string;
  tier?: 'QUICK' | 'STANDARD' | 'DEEP';
  jurisdiction?: string;
}

const TIER_OPTIONS: Record<string, { maxCompanyDepth: number; softNodeCap: number; skipDepth2Filtering: boolean; runResolution: boolean; runScoring: boolean }> = {
  QUICK:    { maxCompanyDepth: 1, softNodeCap: 200,  skipDepth2Filtering: false, runResolution: false, runScoring: false },
  STANDARD: { maxCompanyDepth: 2, softNodeCap: 1000, skipDepth2Filtering: false, runResolution: true,  runScoring: true  },
  DEEP:     { maxCompanyDepth: 3, softNodeCap: 5000, skipDepth2Filtering: true,  runResolution: true,  runScoring: true  },
};

@Processor(INVESTIGATION_QUEUE)
export class InvestigationProcessor extends WorkerHost {
  private readonly logger = new Logger(InvestigationProcessor.name);

  private readonly gleif = new GleifProvider();
  private readonly secEdgar = new SecEdgarProvider();
  private readonly indiaMca = new IndiaMcaProvider();
  private readonly franceSirene = new FranceSireneProvider();
  private readonly germanyNorthdata = new GermanyNorthdataProvider();

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly expansion: GraphExpansionService,
    private readonly addressService: AddressService,
    private readonly resolution: EntityResolutionService,
    private readonly proximity: SanctionsProximityService,
    private readonly riskScoring: RiskScoringService,
    private readonly ch: CompaniesHouseService,
    private readonly uboChains: UboChainService,
    private readonly enrichment: EnrichmentService,
    private readonly pepDetection: PepDetectionService,
    private readonly adverseMedia: AdverseMediaService,
    private readonly aiNarrative: AiNarrativeService,
    private readonly secIntel: SecIntelligenceService,
    private readonly webIntel: WebIntelligenceService,
    private readonly sanctionsDirect: SanctionsDirectService,
    private readonly addressVerification: AddressVerificationService,
    private readonly wayback: WaybackService,
    private readonly politicalDonations: PoliticalDonationsService,
    private readonly regulatoryViolations: RegulatoryViolationsService,
    private readonly cfpbComplaints: CfpbComplaintsService,
    private readonly fatfJurisdiction: FatfJurisdictionService,
    private readonly patentSearch: PatentSearchService,
    private readonly nonprofitLookup: NonprofitLookupService,
    private readonly linkedinIntel: LinkedInIntelligenceService,
    private readonly indiaIntel: IndiaIntelligenceService,
    private readonly indiaSearch: IndiaSearchService,
    private readonly entityMerge: EntityMergeService,
    private readonly graphAnalytics: GraphAnalyticsService,
    private readonly temporalIntel: TemporalIntelService,
    private readonly peerComparison: PeerComparisonService,
    private readonly filingNlp: FilingNlpService,
    private readonly proactiveCrawler: ProactiveCrawlerService,
    private readonly gateway: InvestigationGateway,
  ) {
    super();
  }

  /** Upsert a graph node — returns existing node if duplicate */
  private async upsertNode(data: Partial<GraphNode>): Promise<GraphNode> {
    try {
      return await this.nodes.save(this.nodes.create(data as any)) as any;
    } catch (e: any) {
      if (e?.code === '23505' || e?.message?.includes('duplicate key')) {
        const existing = await this.nodes.findOne({
          where: { investigationId: data.investigationId, entityType: data.entityType, entityId: data.entityId },
        });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /** Upsert a graph edge — silently skip duplicates */
  private async upsertEdge(data: Partial<GraphEdge>): Promise<GraphEdge | null> {
    try {
      return await this.edges.save(this.edges.create(data as any)) as any;
    } catch {
      return null;
    }
  }

  async process(job: Job<InvestigationJobData>): Promise<void> {
    const { investigationId, query, tier = 'STANDARD', jurisdiction = 'gb' } = job.data;
    const opts = TIER_OPTIONS[tier] || TIER_OPTIONS.STANDARD;
    this.logger.log(`Processing investigation ${investigationId} (${query}) tier=${tier} jurisdiction=${jurisdiction}`);

    // Non-UK pipeline: use GLEIF + SEC EDGAR
    if (jurisdiction !== 'gb') {
      return this.processNonUK(investigationId, query, tier, jurisdiction);
    }

    try {
      await this.investigations.update(investigationId, { status: 'FETCHING' });
      this.gateway.emitStatusChanged(investigationId, 'FETCHING');

      const companyNumber = await this.resolveCompanyNumber(query);
      if (!companyNumber) throw new Error('Company not found');

      // Resolve company name for the header
      let companyName = query;
      try {
        const profile = await this.ch.getCompany(companyNumber);
        if (profile?.company_name) companyName = profile.company_name;
      } catch { /* fallback to query */ }

      await this.investigations.update(investigationId, {
        status: 'EXPANDING',
        metadata: { companyNumber, companyName, tier } as any,
      });
      this.gateway.emitStatusChanged(investigationId, 'EXPANDING');

      const result = await this.expansion.expand(
        investigationId,
        companyNumber,
        {
          maxCompanyDepth: opts.maxCompanyDepth,
          softNodeCap: opts.softNodeCap,
          skipDepth2Filtering: opts.skipDepth2Filtering,
        },
        {
          onEntityDiscovered: (n) =>
            this.gateway.emitEntityDiscovered(investigationId, {
              id: n.id,
              entityType: n.entityType,
              entityId: n.entityId,
              label: n.label,
            }),
          onEdgeCreated: (e) =>
            this.gateway.emitEdgeCreated(investigationId, {
              id: e.id,
              source: e.sourceNodeId,
              target: e.targetNodeId,
              type: e.relationshipType,
            }),
          onProgress: (p) => {
            this.gateway.emitProgress(investigationId, p);
            // Periodically persist
            this.investigations.update(investigationId, { progress: p as any }).catch(() => {});
          },
        },
      );

      const addressClusters = await this.addressService.clusterAddresses(investigationId);

      // Enrichment — Wikidata + OpenCorporates for UK companies
      this.gateway.emitStatusChanged(investigationId, 'ENRICHING');
      let ukRootNode: any = null;
      try {
        ukRootNode = await this.nodes.findOne({ where: { investigationId, entityType: 'company', entityId: companyNumber } });
        if (ukRootNode) {
          this.logger.log(`[Enrichment] Starting enrichment for ${companyName} (UK)...`);
          await this.enrichment.enrichCompany(
            investigationId, ukRootNode.id, companyName, companyNumber, 'gb',
            {
              onEntityDiscovered: (n) => this.gateway.emitEntityDiscovered(investigationId, n),
              onProgress: (msg) => this.logger.log(`[Enrichment] ${msg}`),
            },
          );
        }
      } catch (e: any) {
        this.logger.warn(`[Enrichment] UK enrichment failed: ${e?.message}`);
      }

      // UBO chain build — walks PSC tree from the root company up to humans
      let uboChainResult: any[] = [];
      try {
        uboChainResult = await this.uboChains.buildChains(companyNumber, companyName);
        this.logger.log(`UBO chains built for ${investigationId}: ${uboChainResult.length} chain(s)`);
      } catch (e: any) {
        this.logger.warn(`UBO chain build failed: ${e?.message}`);
      }

      let resolutionResult: any = { processed: 0, matches: 0 };
      let proximityResult: any = { scored: 0, flagged: 0 };
      let riskResult: any = { score: 0, findings: [] };

      if (opts.runResolution) {
        await this.investigations.update(investigationId, { status: 'RESOLVING' });
        this.gateway.emitStatusChanged(investigationId, 'RESOLVING');
        await new Promise((r) => setTimeout(r, 400));
        resolutionResult = await this.resolution.resolveInvestigation(investigationId, {
          onEntityMatched: (m) =>
            this.gateway.emitEntityMatched(investigationId, {
              id: m.id,
              sourceEntityType: m.sourceEntityType,
              sourceEntityId: m.sourceEntityId,
              matchedSource: m.matchedSource,
              matchedEntityId: m.matchedEntityId,
              confidenceScore: m.confidenceScore,
              matchReasons: m.matchReasons,
            }),
          onProgress: (p) => this.gateway.emitResolutionProgress(investigationId, p),
        });
        this.gateway.emitResolutionComplete(investigationId, resolutionResult);

        proximityResult = await this.proximity.compute(investigationId);
      }

      if (opts.runScoring) {
        await this.investigations.update(investigationId, { status: 'SCORING' });
        this.gateway.emitStatusChanged(investigationId, 'SCORING');
        // Brief breath so the UI can render the stage transition even on tiny graphs
        await new Promise((r) => setTimeout(r, 400));
        riskResult = await this.riskScoring.run(investigationId, (step, detail) => {
          this.gateway.emitScoringStep(investigationId, { step, detail });
        });
      }

      // Intelligence — deep analysis for UK companies
      this.gateway.emitStatusChanged(investigationId, 'INTELLIGENCE');
      let ukWebIntelResult: any = null;
      let ukSanctionsResult: any = null;
      let ukAddrVerifResult: any = null;
      let ukWaybackResult: any = null;
      let ukFatfResult: any = null;
      let ukNonprofitResult: any = null;
      try {
        this.logger.log(`[Intelligence] Starting deep intelligence for ${companyName} (UK)...`);
        const freshUkRoot = await this.nodes.findOne({ where: { id: ukRootNode?.id } });
        const ukRootMeta = (freshUkRoot?.metadata || {}) as any;
        const ukWebsite = ukRootMeta.website || null;
        const ukFounded = ukRootMeta.foundedDate || null;

        [ukWebIntelResult, ukSanctionsResult, ukAddrVerifResult, ukWaybackResult, ukFatfResult, ukNonprofitResult] = await Promise.all([
          this.webIntel.analyze(investigationId, companyName, ukWebsite).catch(() => null),
          this.sanctionsDirect.screen(investigationId).catch(() => null),
          this.addressVerification.verify(investigationId).catch(() => null),
          this.wayback.analyze(investigationId, companyName, ukWebsite, ukFounded).catch(() => null),
          this.fatfJurisdiction.analyze(investigationId).catch(() => null),
          this.nonprofitLookup.search(investigationId, companyName).catch(() => null),
        ]);

        const ukIntelFindings = [
          ...(ukWebIntelResult?.findings || []),
          ...(ukSanctionsResult?.findings || []),
          ...(ukAddrVerifResult?.findings || []),
          ...(ukWaybackResult?.findings || []),
          ...(ukFatfResult?.findings || []),
          ...(ukNonprofitResult?.findings || []),
        ];
        riskResult.findings = [...riskResult.findings, ...ukIntelFindings];
        const ukBoost = ukIntelFindings.filter((f: any) => f.severity === 'CRITICAL').length * 20
          + ukIntelFindings.filter((f: any) => f.severity === 'HIGH').length * 8
          + ukIntelFindings.filter((f: any) => f.severity === 'MEDIUM').length * 3;
        riskResult.score = Math.min(100, riskResult.score + ukBoost);
        this.logger.log(`[Intelligence] UK done: ${ukIntelFindings.length} findings, score now ${riskResult.score}`);
      } catch (e: any) {
        this.logger.warn(`[Intelligence] UK failed: ${e?.message}`);
      }

      // PEP + Adverse Media for UK
      this.gateway.emitStatusChanged(investigationId, 'PEP_MEDIA');
      let ukPepResults: any[] = [];
      let ukMediaResults: any[] = [];
      try {
        this.logger.log(`[PEP+Media] Starting for ${companyName} (UK)...`);
        const [pepResult, mediaResult] = await Promise.all([
          this.pepDetection.screen(investigationId).catch(() => ({ peps: [], findings: [] })),
          this.adverseMedia.screen(investigationId, companyName).catch(() => ({ hits: [], findings: [] })),
        ]);
        ukPepResults = pepResult.peps;
        ukMediaResults = mediaResult.hits;
        riskResult.findings = [...riskResult.findings, ...pepResult.findings, ...mediaResult.findings];
        const pepMediaBoost = pepResult.findings.length * 15
          + mediaResult.findings.filter((f: any) => f.severity === 'HIGH').length * 10
          + mediaResult.findings.filter((f: any) => f.severity === 'MEDIUM').length * 5;
        riskResult.score = Math.min(100, riskResult.score + pepMediaBoost);
        this.logger.log(`[PEP+Media] UK done: ${ukPepResults.length} PEPs, ${ukMediaResults.length} media hits, score ${riskResult.score}`);
      } catch (e: any) {
        this.logger.warn(`[PEP+Media] UK failed: ${e?.message}`);
      }

      // AI Narrative for UK
      let ukNarrative: any = null;
      try {
        this.gateway.emitStatusChanged(investigationId, 'NARRATIVE');
        this.logger.log(`[Narrative] Generating for ${companyName} (UK)...`);
        ukNarrative = await this.aiNarrative.generate(
          investigationId, companyName, 'gb', riskResult.score, riskResult.findings,
          ukPepResults.map((p: any) => ({ name: p.name, positions: p.positions })),
          ukMediaResults.map((a: any) => ({ entity: a.entity, headline: a.headline, source: a.source, sentiment: a.sentiment })),
        );
      } catch (e: any) {
        this.logger.warn(`[Narrative] UK failed: ${e?.message}`);
      }

      const finalNodeCount = await this.nodes.count({ where: { investigationId } });
      const finalEdgeCount = await this.edges.count({ where: { investigationId } });

      await this.investigations.update(investigationId, {
        status: 'COMPLETE',
        completedAt: new Date(),
        progress: {
          entitiesDiscovered: finalNodeCount,
          edgesCreated: finalEdgeCount,
          tier,
          jurisdiction: 'gb',
          addressClusters,
          uboChains: uboChainResult,
          resolution: resolutionResult,
          proximity: proximityResult,
          riskScore: riskResult.score,
          riskClassification: riskResult.score >= 75 ? 'CRITICAL' : riskResult.score >= 50 ? 'HIGH' : riskResult.score >= 25 ? 'MEDIUM' : 'LOW',
          findings: riskResult.findings,
          narrative: ukNarrative,
          pepCount: ukPepResults.length,
          adverseMediaCount: ukMediaResults.length,
          webIntelligence: ukWebIntelResult ? { websiteExists: ukWebIntelResult.websiteCheck?.exists, courtCases: ukWebIntelResult.courtCases?.length || 0, govContracts: ukWebIntelResult.govContracts?.length || 0 } : null,
          directSanctions: ukSanctionsResult ? { matches: ukSanctionsResult.matches?.length || 0 } : null,
          wayback: ukWaybackResult?.result ? { domain: ukWaybackResult.result.domain, firstSnapshot: ukWaybackResult.result.firstSnapshot, domainAgeYears: ukWaybackResult.result.domainAgeYears } : null,
          fatfFlags: ukFatfResult?.results?.length || 0,
        } as any,
      });
      this.gateway.emitComplete(investigationId, result);

      // Update benchmarks after completion
      try {
        const all = await this.investigations.find({ where: { status: 'COMPLETE' as any } });
        const scores = all.map((i) => (i.progress as any)?.riskScore).filter((s: any): s is number => s != null).sort((a: number, b: number) => a - b);
        if (scores.length > 0) {
          const total = scores.length;
          const avg = Math.round(scores.reduce((s: number, v: number) => s + v, 0) / total);
          const median = scores[Math.floor(total / 2)];
          const low = Math.round((scores.filter((s: number) => s < 25).length / total) * 100);
          const medium = Math.round((scores.filter((s: number) => s >= 25 && s < 50).length / total) * 100);
          const high = Math.round((scores.filter((s: number) => s >= 50 && s < 75).length / total) * 100);
          const critical = Math.round((scores.filter((s: number) => s >= 75).length / total) * 100);
          await this.investigations.query(
            `INSERT INTO investigation_benchmarks (id, "totalInvestigations", "avgScore", "medianScore", "lowPct", "mediumPct", "highPct", "criticalPct", "updatedAt") VALUES (1, $1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT (id) DO UPDATE SET "totalInvestigations"=$1, "avgScore"=$2, "medianScore"=$3, "lowPct"=$4, "mediumPct"=$5, "highPct"=$6, "criticalPct"=$7, "updatedAt"=now()`,
            [total, avg, median, low, medium, high, critical],
          );
        }
      } catch (e: any) { this.logger.warn(`Benchmark update failed: ${e?.message}`); }
    } catch (err: any) {
      this.logger.error(`Investigation ${investigationId} failed: ${err?.message}`);
      await this.investigations.update(investigationId, {
        status: 'FAILED',
        completedAt: new Date(),
        metadata: { error: err?.message } as any,
      });
      this.gateway.emitComplete(investigationId, { status: 'failed', error: err?.message });
    }
  }

  /**
   * Non-UK investigation pipeline using GLEIF + SEC EDGAR.
   * Limited but functional: company profile, ownership chain, sanctions screening.
   */
  private async processNonUK(investigationId: string, query: string, tier: string, jurisdiction: string): Promise<void> {
    try {
      await this.investigations.update(investigationId, { status: 'FETCHING' });
      this.gateway.emitStatusChanged(investigationId, 'FETCHING');

      // Step 1: Fetch company profile — try SEC first for US, then GLEIF
      let profile = null;
      let useCik = false;
      if (jurisdiction === 'us') {
        // If query looks like a CIK (all digits), fetch directly; otherwise search first
        if (/^\d+$/.test(query.trim())) {
          profile = await this.secEdgar.getCompanyProfile(query.trim());
        } else {
          const searchResults = await this.secEdgar.searchCompanies(query);
          if (searchResults.length > 0) {
            profile = await this.secEdgar.getCompanyProfile(searchResults[0].companyNumber);
          }
        }
        if (profile) useCik = true;
      }
      // India: try NSE search first (most reliable for listed cos), then MCA/Zaubacorp
      if (!profile && jurisdiction === 'in') {
        // Try NSE autocomplete — the most reliable source for Indian listed companies
        try {
          const nseSearchRes = await axios.get(`https://www.nseindia.com/api/search/autocomplete?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', Accept: 'application/json' },
            timeout: 10000,
          });
          const symbols = nseSearchRes.data?.symbols || [];
          const equity = symbols.find((s: any) => s.result_type === 'symbol' && s.result_sub_type === 'equity');
          if (equity) {
            profile = {
              name: equity.symbol_info || equity.symbol,
              companyNumber: equity.symbol,
              jurisdiction: 'in',
              jurisdictionLabel: 'India',
              status: 'active' as any,
              incorporationDate: equity.listing_date || null,
              dissolutionDate: null,
              companyType: 'Listed Company (NSE)',
              registeredAddress: null,
              sicCodes: [],
              registryUrl: `https://www.nseindia.com/get-quotes/equity?symbol=${equity.symbol}`,
              source: 'opencorporates' as any,
              dataDepth: 'moderate' as any,
            };
            this.logger.log(`India: found ${equity.symbol_info} (NSE: ${equity.symbol}) via NSE search`);

            // Auto-populate local India DB
            this.indiaSearch.saveDiscovered({
              cin: equity.symbol, // Use NSE symbol as identifier
              companyName: equity.symbol_info || equity.symbol,
              status: 'Active',
              listedStatus: 'Listed',
              companyType: 'Listed Company (NSE)',
            }).catch(() => {});
          }
        } catch (e: any) {
          this.logger.warn(`NSE search failed: ${e?.message}`);
        }

        // Fallback: try Tofler/MCA
        if (!profile) {
          const indiaResults = await this.indiaMca.searchCompanies(query).catch(() => []);
          if (indiaResults.length > 0) {
            const best = indiaResults[0];
            profile = {
              name: best.name,
              companyNumber: best.companyNumber,
              jurisdiction: 'in',
              jurisdictionLabel: 'India',
              status: (best.status || 'active') as any,
              incorporationDate: best.incorporationDate,
              dissolutionDate: null,
              companyType: null,
              registeredAddress: null,
              sicCodes: [],
              registryUrl: best.registryUrl,
              source: 'opencorporates' as any,
              dataDepth: 'basic' as any,
            };
            this.logger.log(`India: found ${best.name} (CIN: ${best.companyNumber}) via MCA search`);

            // Auto-populate local India DB
            this.indiaSearch.saveDiscovered({
              cin: best.companyNumber,
              companyName: best.name,
              status: (best.status as string) || 'Active',
            }).catch(() => {});
          }
        }
      }
      // France: Sirene API (free, rich data with directors + financials)
      if (!profile && jurisdiction === 'fr') {
        try {
          const frResults = await this.franceSirene.searchCompanies(query);
          if (frResults.length > 0) {
            profile = await this.franceSirene.getCompanyProfile(frResults[0].companyNumber);
            if (profile) this.logger.log(`France: found ${profile.name} (SIREN: ${profile.companyNumber}) via Sirene API`);
          }
        } catch (e: any) { this.logger.warn(`France search failed: ${e?.message}`); }
      }

      // Germany: North Data (scraped JSON-LD)
      if (!profile && jurisdiction === 'de') {
        try {
          const deResults = await this.germanyNorthdata.searchCompanies(query);
          if (deResults.length > 0) {
            profile = await this.germanyNorthdata.getCompanyProfile(deResults[0].registryUrl);
            if (profile) this.logger.log(`Germany: found ${profile.name} via North Data`);
          }
        } catch (e: any) { this.logger.warn(`Germany search failed: ${e?.message}`); }
      }

      if (!profile) {
        profile = await this.gleif.getCompanyProfile(query);
      }
      // Last resort: search GLEIF by name
      if (!profile) {
        const jCodeMap: Record<string, string> = { in: 'IN', fr: 'FR', de: 'DE', nl: 'NL', ie: 'IE', sg: 'SG' };
        const gleifResults = await this.gleif.searchCompanies(query, jCodeMap[jurisdiction] || undefined).catch(() => []);
        if (gleifResults.length > 0) {
          profile = await this.gleif.getCompanyProfile(gleifResults[0].companyNumber).catch(() => null);
        }
      }
      if (!profile) throw new Error(`Company not found (query: ${query}, jurisdiction: ${jurisdiction})`);

      const companyName = profile.name;
      this.logger.log(`Non-UK: ${companyName} (${profile.companyNumber}) in ${jurisdiction}`);

      const companyId = profile.companyNumber;
      await this.investigations.update(investigationId, {
        status: 'EXPANDING',
        metadata: { companyNumber: companyId, companyName, tier, jurisdiction, dataDepth: useCik ? 'moderate' : 'basic', ...(profile as any) } as any,
      });
      this.gateway.emitStatusChanged(investigationId, 'EXPANDING');

      // Create root company node
      const rootNode = await this.upsertNode({
        investigationId, entityType: 'company', entityId: companyId, label: companyName,
        metadata: {
          status: profile.status, companyType: profile.companyType,
          jurisdiction: profile.jurisdiction, registryUrl: profile.registryUrl,
          registeredAddress: profile.registeredAddress,
          sicCodes: profile.sicCodes,
          dataSource: useCik ? 'sec-edgar' : 'gleif',
          dataDepth: useCik ? 'moderate' : 'basic',
          ...((profile as any).ticker ? { ticker: (profile as any).ticker, exchange: (profile as any).exchange, sicDescription: (profile as any).sicDescription, stateOfIncorporation: (profile as any).stateOfIncorporation, category: (profile as any).category } : {}),
        },
      });
      this.gateway.emitEntityDiscovered(investigationId, { id: rootNode.id, entityType: 'company', entityId: companyId, label: companyName });

      // Step 2: Get ownership chain from GLEIF
      // GLEIF ownership needs LEI - for SEC companies, try to find LEI first
      let leiForOwnership = useCik ? null : companyId;
      if (useCik) {
        // Search GLEIF by company name to find LEI
        const gleifResults = await this.gleif.searchCompanies(companyName, 'US');
        const match = gleifResults.find((r) => r.name.toUpperCase().includes(companyName.split(' ')[0].toUpperCase()));
        if (match) leiForOwnership = match.companyNumber;
      }

      const [directParent, ultimateParent, children] = leiForOwnership ? await Promise.all([
        this.gleif.getDirectParent(leiForOwnership),
        this.gleif.getUltimateParent(leiForOwnership),
        this.gleif.getChildren(leiForOwnership),
      ]) : [null, null, []];

      const uboChains: any[] = [];
      const ownershipPath: any[] = [];

      if (directParent) {
        const parentNode = await this.upsertNode({
          investigationId, entityType: 'company', entityId: directParent.companyNumber, label: directParent.name,
          metadata: { status: directParent.status, jurisdiction: directParent.jurisdiction, dataSource: 'gleif' },
        });
        await this.edges.save(this.edges.create({
          investigationId, sourceNodeId: parentNode.id, targetNodeId: rootNode.id, relationshipType: 'psc',
          metadata: { type: 'direct-parent' },
        }));
        this.gateway.emitEntityDiscovered(investigationId, { id: parentNode.id, entityType: 'company', entityId: directParent.companyNumber, label: directParent.name });
        ownershipPath.push({ kind: 'company', name: directParent.name, jurisdiction: directParent.jurisdiction, companyNumber: directParent.companyNumber, level: 1 });
      }

      if (ultimateParent && ultimateParent.companyNumber !== directParent?.companyNumber) {
        const ultNode = await this.upsertNode({
          investigationId, entityType: 'company', entityId: ultimateParent.companyNumber, label: ultimateParent.name,
          metadata: { status: ultimateParent.status, jurisdiction: ultimateParent.jurisdiction, dataSource: 'gleif' },
        });
        if (directParent) {
          const parentNode = await this.nodes.findOne({ where: { investigationId, entityId: directParent.companyNumber } });
          if (parentNode) {
            await this.edges.save(this.edges.create({
              investigationId, sourceNodeId: ultNode.id, targetNodeId: parentNode.id, relationshipType: 'psc',
              metadata: { type: 'ultimate-parent' },
            }));
          }
        }
        this.gateway.emitEntityDiscovered(investigationId, { id: ultNode.id, entityType: 'company', entityId: ultimateParent.companyNumber, label: ultimateParent.name });
        ownershipPath.unshift({ kind: 'company', name: ultimateParent.name, jurisdiction: ultimateParent.jurisdiction, companyNumber: ultimateParent.companyNumber, level: 2 });
      }

      // Add target to ownership path
      ownershipPath.push({ kind: 'company', name: companyName, companyNumber: companyId, level: 0 });

      if (ownershipPath.length > 1) {
        uboChains.push({
          id: `${companyId}-0`,
          path: ownershipPath,
          rootCompanyName: companyName,
          rootCompanyNumber: companyId,
          terminationReason: ultimateParent ? 'reached ultimate parent' : 'reached direct parent',
        });
      }

      // Step 3: Add subsidiaries
      for (const child of children.slice(0, 20)) {
        const childNode = await this.upsertNode({
          investigationId, entityType: 'company', entityId: child.companyNumber, label: child.name,
          metadata: { status: child.status, jurisdiction: child.jurisdiction, dataSource: 'gleif' },
        });
        await this.edges.save(this.edges.create({
          investigationId, sourceNodeId: rootNode.id, targetNodeId: childNode.id, relationshipType: 'psc',
          metadata: { type: 'subsidiary' },
        }));
        this.gateway.emitEntityDiscovered(investigationId, { id: childNode.id, entityType: 'company', entityId: child.companyNumber, label: child.name });
      }

      // Step 4: If US, build deep officer network from SEC Form 4 filings (depth 2)
      if (jurisdiction === 'us') {
        const SOFT_CAP = tier === 'QUICK' ? 50 : tier === 'DEEP' ? 1000 : 500;
        const MAX_DEPTH = tier === 'QUICK' ? 1 : 2;
        const expandedCompanyCiks = new Set<string>([companyId.replace(/^0+/, '')]);
        const knownPersonCiks = new Set<string>();
        let totalNodes = 1;

        // Helper to emit progress
        const emitProg = async (depth: number) => {
          const nc = await this.nodes.count({ where: { investigationId } });
          const ec = await this.edges.count({ where: { investigationId } });
          totalNodes = nc;
          this.gateway.emitProgress(investigationId, { entitiesDiscovered: nc, edgesCreated: ec, currentDepth: depth, apiCallsMade: 0 });
        };

        // Helper to add a person + their other companies
        const addOfficer = async (officer: SecNet.SecOfficer, companyNodeId: string, depth: number): Promise<string[]> => {
          if (knownPersonCiks.has(officer.cik) || totalNodes >= SOFT_CAP) return [];
          knownPersonCiks.add(officer.cik);

          const role = officer.title || (officer.isDirector ? 'Director' : 'Officer');
          const personNode = await this.upsertNode({
            investigationId, entityType: 'person', entityId: `sec-${officer.cik}`, label: officer.name,
            metadata: { role, isDirector: officer.isDirector, isOfficer: officer.isOfficer, cik: officer.cik, dataSource: 'sec-edgar', otherCompanyCount: officer.otherCompanies.length },
          });
          await this.edges.save(this.edges.create({
            investigationId, sourceNodeId: companyNodeId, targetNodeId: personNode.id,
            relationshipType: officer.isDirector ? 'director' : 'appointment', metadata: { role },
          }));
          this.gateway.emitEntityDiscovered(investigationId, { id: personNode.id, entityType: 'person', entityId: personNode.entityId, label: officer.name });
          totalNodes++;

          // Add their other companies
          const newCompanyCiks: string[] = [];
          for (const otherCo of officer.otherCompanies) {
            if (totalNodes >= SOFT_CAP) break;
            const coEntityId = `sec-co-${otherCo.cik}`;
            let coNode = await this.nodes.findOne({ where: { investigationId, entityId: coEntityId } });
            if (!coNode) {
              coNode = await this.upsertNode({
                investigationId, entityType: 'company', entityId: coEntityId, label: otherCo.name,
                metadata: { ticker: otherCo.ticker, cik: otherCo.cik, dataSource: 'sec-edgar' },
              });
              this.gateway.emitEntityDiscovered(investigationId, { id: coNode.id, entityType: 'company', entityId: coEntityId, label: otherCo.name });
              totalNodes++;
              if (!expandedCompanyCiks.has(otherCo.cik)) newCompanyCiks.push(otherCo.cik);
            }
            await this.edges.save(this.edges.create({
              investigationId, sourceNodeId: coNode.id, targetNodeId: personNode.id,
              relationshipType: 'director', metadata: { role: otherCo.title || 'insider' },
            })).catch(() => {});
          }
          return newCompanyCiks;
        };

        // === DEPTH 1: Target company officers ===
        this.logger.log(`[Depth 1] Expanding ${companyName} (CIK ${companyId})`);
        const depth1Filers = await SecNet.getForm4Filers(companyId);
        this.logger.log(`[Depth 1] Found ${depth1Filers.length} Form 4 filers`);

        const depth2CompanyCiks: string[] = [];

        for (let batch = 0; batch < depth1Filers.length && totalNodes < SOFT_CAP; batch += 3) {
          const chunk = depth1Filers.slice(batch, batch + 3);
          const results = await Promise.all(chunk.map((fCik) => SecNet.getOfficerDetails(fCik, companyId).catch(() => null)));
          for (const officer of results) {
            if (!officer || totalNodes >= SOFT_CAP) continue;
            const newCiks = await addOfficer(officer, rootNode.id, 1);
            depth2CompanyCiks.push(...newCiks);
          }
          await emitProg(1);
        }
        this.logger.log(`[Depth 1] Complete: ${totalNodes} entities, ${depth2CompanyCiks.length} companies to expand at depth 2`);

        // === DEPTH 2: Expand officers' other companies ===
        if (MAX_DEPTH >= 2 && totalNodes < SOFT_CAP) {
          // Only expand companies where the original officer has a significant role
          const toExpand = depth2CompanyCiks.slice(0, 15); // cap at 15 companies for depth 2
          this.logger.log(`[Depth 2] Expanding ${toExpand.length} companies...`);

          for (const d2Cik of toExpand) {
            if (totalNodes >= SOFT_CAP) break;
            if (expandedCompanyCiks.has(d2Cik)) continue;
            expandedCompanyCiks.add(d2Cik);

            try {
              const d2Filers = await SecNet.getForm4Filers(d2Cik);
              const coNode = await this.nodes.findOne({ where: { investigationId, entityId: `sec-co-${d2Cik}` } });
              if (!coNode || d2Filers.length === 0) continue;

              // Only get top 10 officers per company at depth 2
              for (let b = 0; b < Math.min(d2Filers.length, 10) && totalNodes < SOFT_CAP; b += 3) {
                const chunk = d2Filers.slice(b, b + 3);
                const results = await Promise.all(chunk.map((fCik) => SecNet.getOfficerDetails(fCik, d2Cik).catch(() => null)));
                for (const officer of results) {
                  if (!officer || totalNodes >= SOFT_CAP) continue;
                  await addOfficer(officer, coNode.id, 2);
                }
              }
              await emitProg(2);
            } catch { continue; }
          }
          this.logger.log(`[Depth 2] Complete: ${totalNodes} entities total`);
        }

        this.logger.log(`SEC network built: ${totalNodes} entities across ${expandedCompanyCiks.size} companies`);
      }

      // Step 4b: Deep enrichment — scrape Wikidata, SEC filings (DEF14A/10-K), OpenCorporates
      this.gateway.emitStatusChanged(investigationId, 'ENRICHING');
      this.logger.log(`[Enrichment] Starting deep enrichment for ${companyName}...`);
      try {
        const enrichStats = await this.enrichment.enrichCompany(
          investigationId, rootNode.id, companyName, companyId, jurisdiction,
          {
            onEntityDiscovered: (n) => this.gateway.emitEntityDiscovered(investigationId, n),
            onProgress: (msg) => this.logger.log(`[Enrichment] ${msg}`),
          },
        );
        this.logger.log(
          `[Enrichment] Done: +${enrichStats.locationsAdded} locations, +${enrichStats.peopleAdded} people, ` +
          `+${enrichStats.subsidiariesAdded} subsidiaries, +${enrichStats.ownersAdded} owners`,
        );
      } catch (e: any) {
        this.logger.warn(`[Enrichment] Failed: ${e?.message}`);
      }

      // Step 5: Sanctions screening
      await this.investigations.update(investigationId, { status: 'RESOLVING' });
      this.gateway.emitStatusChanged(investigationId, 'RESOLVING');

      let resolutionResult: any = { processed: 0, matches: 0 };
      try {
        resolutionResult = await this.resolution.resolveInvestigation(investigationId, {
          onEntityMatched: (m) => this.gateway.emitEntityMatched(investigationId, {
            id: m.id, sourceEntityType: m.sourceEntityType, sourceEntityId: m.sourceEntityId,
            matchedSource: m.matchedSource, matchedEntityId: m.matchedEntityId,
            confidenceScore: m.confidenceScore, matchReasons: m.matchReasons,
          }),
          onProgress: (p) => this.gateway.emitResolutionProgress(investigationId, p),
        });
        this.gateway.emitResolutionComplete(investigationId, resolutionResult);
      } catch (e: any) { this.logger.warn(`Non-UK resolution failed: ${e?.message}`); }

      let proximityResult: any = { scored: 0, flagged: 0 };
      try { proximityResult = await this.proximity.compute(investigationId); } catch {}

      // Step 6: Basic risk scoring
      await this.investigations.update(investigationId, { status: 'SCORING' });
      this.gateway.emitStatusChanged(investigationId, 'SCORING');

      let riskResult: any = { score: 0, findings: [] };
      try {
        riskResult = await this.riskScoring.run(investigationId, (step, detail) => {
          this.gateway.emitScoringStep(investigationId, { step, detail });
        });
      } catch (e: any) { this.logger.warn(`Non-UK scoring failed: ${e?.message}`); }

      // Step 7: Deep Intelligence — all sources in parallel
      this.gateway.emitStatusChanged(investigationId, 'INTELLIGENCE');
      let secIntelResult: any = null;
      let webIntelResult: any = null;
      let sanctionsDirectResult: any = null;
      let addressVerifResult: any = null;
      let waybackResult: any = null;
      let donationsResult: any = null;
      let regulatoryResult: any = null;
      let cfpbResult: any = null;
      let fatfResult: any = null;
      let patentResult: any = null;
      let nonprofitResult: any = null;
      try {
        this.logger.log(`[Intelligence] Starting deep intelligence analysis (7 sources)...`);
        // Reload root node to get enriched metadata (website, foundedDate etc)
        const freshRoot = await this.nodes.findOne({ where: { id: rootNode.id } });
        const rootMeta = (freshRoot?.metadata || {}) as any;
        const website = rootMeta.website || null;
        const foundedDate = rootMeta.foundedDate || rootMeta.incorporationDate || null;

        // ALL intelligence sources in ONE Promise.all — maximum parallelization
        const catch_ = (name: string) => (e: any) => { this.logger.warn(`${name} failed: ${e?.message}`); return null; };

        const [
          secResult, webResult, sanctionsResult, addrResult, wbResult, donResult, regResult,
          linkedinResult, indiaResult, cfpbRes, fatfRes, patentRes, nonprofitRes,
        ] = await Promise.all([
          jurisdiction === 'us' ? this.secIntel.analyze(investigationId, companyId, companyName).catch(catch_('SEC intel')) : Promise.resolve(null),
          this.webIntel.analyze(investigationId, companyName, website).catch(catch_('Web intel')),
          this.sanctionsDirect.screen(investigationId).catch(catch_('Sanctions')),
          this.addressVerification.verify(investigationId).catch(catch_('Address')),
          this.wayback.analyze(investigationId, companyName, website, foundedDate).catch(catch_('Wayback')),
          this.politicalDonations.search(investigationId).catch(catch_('FEC')),
          jurisdiction === 'us' ? this.regulatoryViolations.search(investigationId, companyName).catch(catch_('EPA/OSHA')) : Promise.resolve(null),
          this.linkedinIntel.search(investigationId, companyName).catch(catch_('LinkedIn')),
          jurisdiction === 'in' ? this.indiaIntel.analyze(investigationId, companyName).catch(catch_('India intel')) : Promise.resolve(null),
          this.cfpbComplaints.search(investigationId, companyName).catch(catch_('CFPB')),
          this.fatfJurisdiction.analyze(investigationId).catch(catch_('FATF')),
          jurisdiction === 'us' ? this.patentSearch.search(investigationId, companyName).catch(catch_('Patents')) : Promise.resolve(null),
          this.nonprofitLookup.search(investigationId, companyName).catch(catch_('Nonprofit')),
        ]);
        cfpbResult = cfpbRes; fatfResult = fatfRes; patentResult = patentRes; nonprofitResult = nonprofitRes;

        secIntelResult = secResult;
        webIntelResult = webResult;
        sanctionsDirectResult = sanctionsResult;
        addressVerifResult = addrResult;
        waybackResult = wbResult;
        donationsResult = donResult;
        regulatoryResult = regResult;

        // Merge all findings and boost score
        const allIntelFindings = [
          ...(secResult?.findings || []),
          ...(webResult?.findings || []),
          ...(sanctionsResult?.findings || []),
          ...(addrResult?.findings || []),
          ...(wbResult?.findings || []),
          ...(donResult?.findings || []),
          ...(regResult?.findings || []),
          ...(cfpbResult?.findings || []),
          ...(fatfResult?.findings || []),
          ...(patentResult?.findings || []),
          ...(nonprofitResult?.findings || []),
          ...(linkedinResult?.findings || []),
          ...(indiaResult?.findings || []),
        ];

        riskResult.findings = [...riskResult.findings, ...allIntelFindings];

        const boost =
          allIntelFindings.filter((f: any) => f.severity === 'CRITICAL').length * 20
          + allIntelFindings.filter((f: any) => f.severity === 'HIGH').length * 8
          + allIntelFindings.filter((f: any) => f.severity === 'MEDIUM').length * 3;
        riskResult.score = Math.min(100, riskResult.score + boost);

        this.logger.log(
          `[Intelligence] Done: ${allIntelFindings.length} total findings from 7 sources, score now ${riskResult.score}`,
        );
      } catch (e: any) {
        this.logger.warn(`[Intelligence] Failed: ${e?.message}`);
      }

      // Step 8: Deep Intelligence Analysis (entity merge, graph analytics, temporal, NLP, peer comparison, cross-investigation)
      try {
        this.logger.log(`[Deep Intel] Running 6-phase intelligence analysis...`);
        const [mergeResult, analyticsResult, temporalResult, peerResult, nlpResult, crossResult] = await Promise.all([
          this.entityMerge.merge(investigationId).catch((e) => { this.logger.warn(`Entity merge failed: ${e?.message}`); return null; }),
          this.graphAnalytics.analyze(investigationId).catch((e) => { this.logger.warn(`Graph analytics failed: ${e?.message}`); return null; }),
          this.temporalIntel.analyze(investigationId).catch((e) => { this.logger.warn(`Temporal analysis failed: ${e?.message}`); return null; }),
          this.peerComparison.benchmark(investigationId).catch((e) => { this.logger.warn(`Peer comparison failed: ${e?.message}`); return null; }),
          this.filingNlp.analyze(investigationId).catch((e) => { this.logger.warn(`NLP analysis failed: ${e?.message}`); return null; }),
          this.proactiveCrawler.crossLink(investigationId).catch((e) => { this.logger.warn(`Cross-link failed: ${e?.message}`); return null; }),
        ]);

        const deepFindings = [
          ...(mergeResult?.findings || []),
          ...(analyticsResult?.findings || []),
          ...(temporalResult?.findings || []),
          ...(peerResult?.findings || []),
          ...(nlpResult?.findings || []),
          ...(crossResult?.findings || []),
        ];
        riskResult.findings = [...riskResult.findings, ...deepFindings];
        const deepBoost = deepFindings.filter((f: any) => f.severity === 'CRITICAL').length * 15
          + deepFindings.filter((f: any) => f.severity === 'HIGH').length * 6
          + deepFindings.filter((f: any) => f.severity === 'MEDIUM').length * 2;
        riskResult.score = Math.min(100, riskResult.score + deepBoost);

        this.logger.log(
          `[Deep Intel] Done: ${deepFindings.length} findings (merge=${mergeResult?.totalMerged || 0}, ` +
          `cycles=${analyticsResult?.cycles?.length || 0}, clusters=${temporalResult?.clusters?.length || 0}, ` +
          `anomalies=${peerResult?.anomalies?.length || 0}, nlp=${nlpResult?.riskLanguage?.length || 0}, ` +
          `crossLinks=${crossResult?.links?.length || 0}), score now ${riskResult.score}`,
        );
      } catch (e: any) {
        this.logger.warn(`[Deep Intel] Failed: ${e?.message}`);
      }

      // Step 9: PEP Detection + Adverse Media (run in parallel)
      this.gateway.emitStatusChanged(investigationId, 'PEP_MEDIA');
      this.logger.log(`[PEP+Media] Starting PEP detection and adverse media screening...`);
      let pepResults: any[] = [];
      let adverseMediaResults: any[] = [];
      try {
        const [pepResult, mediaResult] = await Promise.all([
          this.pepDetection.screen(investigationId).catch((e) => {
            this.logger.warn(`PEP detection failed: ${e?.message}`);
            return { peps: [], findings: [] };
          }),
          this.adverseMedia.screen(investigationId, companyName).catch((e) => {
            this.logger.warn(`Adverse media failed: ${e?.message}`);
            return { hits: [], findings: [] };
          }),
        ]);

        pepResults = pepResult.peps;
        adverseMediaResults = mediaResult.hits;

        // Merge PEP + media findings into risk results
        riskResult.findings = [...riskResult.findings, ...pepResult.findings, ...mediaResult.findings];

        // Recalculate score with PEP + media
        const pepBoost = pepResult.findings.length * 15;
        const mediaBoost = mediaResult.findings.filter((f: any) => f.severity === 'HIGH').length * 10
          + mediaResult.findings.filter((f: any) => f.severity === 'MEDIUM').length * 5;
        riskResult.score = Math.min(100, riskResult.score + pepBoost + mediaBoost);

        this.logger.log(`[PEP+Media] Done: ${pepResults.length} PEPs, ${adverseMediaResults.length} media hits, score now ${riskResult.score}`);
      } catch (e: any) {
        this.logger.warn(`[PEP+Media] Failed: ${e?.message}`);
      }

      // Step 8: AI Risk Narrative
      let narrative: any = null;
      try {
        this.gateway.emitStatusChanged(investigationId, 'NARRATIVE');
        this.logger.log(`[Narrative] Generating AI risk narrative...`);
        narrative = await this.aiNarrative.generate(
          investigationId, companyName, jurisdiction, riskResult.score, riskResult.findings,
          pepResults.map((p: any) => ({ name: p.name, positions: p.positions })),
          adverseMediaResults.map((a: any) => ({ entity: a.entity, headline: a.headline, source: a.source, sentiment: a.sentiment })),
        );
        this.logger.log(`[Narrative] Generated: ${narrative.keyFindings?.length || 0} key findings`);
      } catch (e: any) {
        this.logger.warn(`[Narrative] Failed: ${e?.message}`);
      }

      // Count entities
      const nodeCount = await this.nodes.count({ where: { investigationId } });
      const edgeCount = await this.edges.count({ where: { investigationId } });

      // Complete
      await this.investigations.update(investigationId, {
        status: 'COMPLETE',
        completedAt: new Date(),
        progress: {
          entitiesDiscovered: nodeCount,
          edgesCreated: edgeCount,
          currentDepth: 1,
          tier,
          jurisdiction,
          dataDepth: 'enriched',
          uboChains,
          resolution: resolutionResult,
          proximity: proximityResult,
          riskScore: riskResult.score,
          riskClassification: riskResult.score >= 75 ? 'CRITICAL' : riskResult.score >= 50 ? 'HIGH' : riskResult.score >= 25 ? 'MEDIUM' : 'LOW',
          findings: riskResult.findings,
          narrative,
          pepCount: pepResults.length,
          adverseMediaCount: adverseMediaResults.length,
          secIntelligence: secIntelResult ? {
            materialEvents: secIntelResult.events?.length || 0,
            insiderSignal: secIntelResult.insiderSignal?.netDirection,
            insiderSignalStrength: secIntelResult.insiderSignal?.signalStrength,
            riskFactorCount: secIntelResult.riskFactors?.totalRiskFactors || 0,
            financials: secIntelResult.financials ? {
              profitMargin: secIntelResult.financials.profitMargin,
              debtToEquity: secIntelResult.financials.debtToEquity,
              currentRatio: secIntelResult.financials.currentRatio,
              flags: secIntelResult.financials.flags,
            } : null,
          } : null,
          webIntelligence: webIntelResult ? {
            websiteExists: webIntelResult.websiteCheck?.exists,
            govContracts: webIntelResult.govContracts?.length || 0,
            courtCases: webIntelResult.courtCases?.length || 0,
          } : null,
          directSanctions: sanctionsDirectResult ? {
            matches: sanctionsDirectResult.matches?.length || 0,
            sources: [...new Set((sanctionsDirectResult.matches || []).map((m: any) => m.source))],
          } : null,
          addressVerification: addressVerifResult ? {
            checked: addressVerifResult.results?.length || 0,
            flagged: addressVerifResult.results?.filter((r: any) => r.flags.length > 0).length || 0,
          } : null,
          wayback: waybackResult?.result ? {
            domain: waybackResult.result.domain,
            firstSnapshot: waybackResult.result.firstSnapshot,
            totalSnapshots: waybackResult.result.totalSnapshots,
            domainAgeYears: waybackResult.result.domainAgeYears,
            flags: waybackResult.result.flags,
          } : null,
          politicalDonations: donationsResult ? {
            totalDonations: donationsResult.donations?.length || 0,
            totalAmount: donationsResult.donations?.reduce((s: number, d: any) => s + (d.amount || 0), 0) || 0,
          } : null,
          regulatoryViolations: regulatoryResult ? {
            epa: regulatoryResult.epaViolations?.length || 0,
            osha: regulatoryResult.oshaViolations?.length || 0,
          } : null,
          cfpbComplaints: cfpbResult?.result ? {
            total: cfpbResult.result.totalComplaints,
            recent: cfpbResult.result.recentComplaints,
          } : null,
          fatfFlags: fatfResult?.results?.length || 0,
          patents: patentResult?.result ? {
            total: patentResult.result.totalPatents,
            recent: patentResult.result.recentPatents,
          } : null,
          nonprofit: nonprofitResult?.result?.found || false,
        } as any,
      });
      this.gateway.emitComplete(investigationId, {});
      this.logger.log(`Non-UK investigation ${investigationId} COMPLETE: ${companyName}, score=${riskResult.score}, PEPs=${pepResults.length}, media=${adverseMediaResults.length}`);

    } catch (e: any) {
      this.logger.error(`Non-UK investigation ${investigationId} FAILED: ${e?.message}`);
      await this.investigations.update(investigationId, {
        status: 'FAILED',
        metadata: () => `jsonb_set(COALESCE(metadata, '{}')::jsonb, '{error}', '"${(e?.message || 'Unknown error').replace(/"/g, '')}"')`,
      } as any);
    }
  }

  private async resolveCompanyNumber(query: string): Promise<string | null> {
    if (/^[A-Z0-9]{6,10}$/i.test(query.trim())) return query.trim().toUpperCase();
    const result = await this.ch.searchCompanies(query).catch(() => null);
    return result?.items?.[0]?.company_number || null;
  }
}
