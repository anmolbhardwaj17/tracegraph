import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
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
import { InvestigationGateway } from './investigation.gateway';

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

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    private readonly expansion: GraphExpansionService,
    private readonly addressService: AddressService,
    private readonly resolution: EntityResolutionService,
    private readonly proximity: SanctionsProximityService,
    private readonly riskScoring: RiskScoringService,
    private readonly ch: CompaniesHouseService,
    private readonly uboChains: UboChainService,
    private readonly gateway: InvestigationGateway,
  ) {
    super();
  }

  async process(job: Job<InvestigationJobData>): Promise<void> {
    const { investigationId, query, tier = 'STANDARD' } = job.data;
    const opts = TIER_OPTIONS[tier] || TIER_OPTIONS.STANDARD;
    this.logger.log(`Processing investigation ${investigationId} (${query}) tier=${tier}`);

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

      await this.investigations.update(investigationId, {
        status: 'COMPLETE',
        completedAt: new Date(),
        progress: {
          ...result,
          tier,
          addressClusters,
          uboChains: uboChainResult,
          resolution: resolutionResult,
          proximity: proximityResult,
          riskScore: riskResult.score,
          findings: riskResult.findings,
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

  private async resolveCompanyNumber(query: string): Promise<string | null> {
    if (/^[A-Z0-9]{6,10}$/i.test(query.trim())) return query.trim().toUpperCase();
    const result = await this.ch.searchCompanies(query).catch(() => null);
    return result?.items?.[0]?.company_number || null;
  }
}
