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
import { GleifProvider } from '../jurisdictions/providers/gleif.provider';
import { SecEdgarProvider } from '../jurisdictions/providers/sec-edgar.provider';
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
    private readonly gateway: InvestigationGateway,
  ) {
    super();
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
        profile = await this.secEdgar.getCompanyProfile(query);
        if (profile) useCik = true;
      }
      if (!profile) {
        profile = await this.gleif.getCompanyProfile(query);
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
      const rootNode = await this.nodes.save(this.nodes.create({
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
      }));
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
        const parentNode = await this.nodes.save(this.nodes.create({
          investigationId, entityType: 'company', entityId: directParent.companyNumber, label: directParent.name,
          metadata: { status: directParent.status, jurisdiction: directParent.jurisdiction, dataSource: 'gleif' },
        }));
        await this.edges.save(this.edges.create({
          investigationId, sourceNodeId: parentNode.id, targetNodeId: rootNode.id, relationshipType: 'psc',
          metadata: { type: 'direct-parent' },
        }));
        this.gateway.emitEntityDiscovered(investigationId, { id: parentNode.id, entityType: 'company', entityId: directParent.companyNumber, label: directParent.name });
        ownershipPath.push({ kind: 'company', name: directParent.name, jurisdiction: directParent.jurisdiction, companyNumber: directParent.companyNumber, level: 1 });
      }

      if (ultimateParent && ultimateParent.companyNumber !== directParent?.companyNumber) {
        const ultNode = await this.nodes.save(this.nodes.create({
          investigationId, entityType: 'company', entityId: ultimateParent.companyNumber, label: ultimateParent.name,
          metadata: { status: ultimateParent.status, jurisdiction: ultimateParent.jurisdiction, dataSource: 'gleif' },
        }));
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
        const childNode = await this.nodes.save(this.nodes.create({
          investigationId, entityType: 'company', entityId: child.companyNumber, label: child.name,
          metadata: { status: child.status, jurisdiction: child.jurisdiction, dataSource: 'gleif' },
        }));
        await this.edges.save(this.edges.create({
          investigationId, sourceNodeId: rootNode.id, targetNodeId: childNode.id, relationshipType: 'psc',
          metadata: { type: 'subsidiary' },
        }));
        this.gateway.emitEntityDiscovered(investigationId, { id: childNode.id, entityType: 'company', entityId: child.companyNumber, label: child.name });
      }

      // Step 4: If US, build officer network from SEC Form 4 filings
      if (jurisdiction === 'us') {
        this.logger.log(`Building SEC officer network for CIK ${companyId}...`);
        const filerCiks = await SecNet.getForm4Filers(companyId);
        this.logger.log(`Found ${filerCiks.length} Form 4 filers for ${companyName}`);

        // Get details for each officer (in batches of 3 to respect rate limits)
        for (let batch = 0; batch < filerCiks.length; batch += 3) {
          const chunk = filerCiks.slice(batch, batch + 3);
          const officerResults = await Promise.all(
            chunk.map((fCik) => SecNet.getOfficerDetails(fCik, companyId).catch(() => null)),
          );

          for (const officer of officerResults) {
            if (!officer) continue;
            const role = officer.title || (officer.isDirector ? 'Director' : 'Officer');

            // Create person node
            const personNode = await this.nodes.save(this.nodes.create({
              investigationId,
              entityType: 'person',
              entityId: `sec-${officer.cik}`,
              label: officer.name,
              metadata: {
                role, isDirector: officer.isDirector, isOfficer: officer.isOfficer,
                cik: officer.cik, dataSource: 'sec-edgar',
                otherCompanyCount: officer.otherCompanies.length,
              },
            }));
            await this.edges.save(this.edges.create({
              investigationId, sourceNodeId: rootNode.id, targetNodeId: personNode.id,
              relationshipType: officer.isDirector ? 'director' : 'appointment',
              metadata: { role },
            }));
            this.gateway.emitEntityDiscovered(investigationId, { id: personNode.id, entityType: 'person', entityId: personNode.entityId, label: officer.name });

            // Add their other companies (cross-directorships)
            for (const otherCo of officer.otherCompanies) {
              // Check if company node already exists
              let coNode = await this.nodes.findOne({ where: { investigationId, entityId: `sec-co-${otherCo.cik}` } });
              if (!coNode) {
                coNode = await this.nodes.save(this.nodes.create({
                  investigationId,
                  entityType: 'company',
                  entityId: `sec-co-${otherCo.cik}`,
                  label: otherCo.name,
                  metadata: { ticker: otherCo.ticker, cik: otherCo.cik, dataSource: 'sec-edgar' },
                }));
                this.gateway.emitEntityDiscovered(investigationId, { id: coNode.id, entityType: 'company', entityId: coNode.entityId, label: otherCo.name });
              }
              // Edge: person -> other company
              await this.edges.save(this.edges.create({
                investigationId, sourceNodeId: coNode.id, targetNodeId: personNode.id,
                relationshipType: 'director',
                metadata: { role: otherCo.title || 'insider' },
              })).catch(() => {}); // ignore duplicate edge
            }
          }
          this.gateway.emitProgress(investigationId, {
            entitiesDiscovered: await this.nodes.count({ where: { investigationId } }),
            edgesCreated: await this.edges.count({ where: { investigationId } }),
            currentDepth: 1,
            apiCallsMade: 0,
          });
        }
        this.logger.log(`SEC officer network built: ${await this.nodes.count({ where: { investigationId } })} entities`);
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
          dataDepth: 'basic',
          uboChains,
          resolution: resolutionResult,
          proximity: proximityResult,
          riskScore: riskResult.score,
          findings: riskResult.findings,
        } as any,
      });
      this.gateway.emitComplete(investigationId, {});
      this.logger.log(`Non-UK investigation ${investigationId} COMPLETE: ${companyName}, score=${riskResult.score}`);

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
