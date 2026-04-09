import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';
import { AnomalyDetectionService } from '../anomaly/anomaly.service';
import { AddressAnalysisService } from '../anomaly/address-analysis.service';
import { OwnershipCycleService } from '../anomaly/ownership-cycle.service';
import { CommunityDetectionService } from '../anomaly/community-detection.service';
import { TemporalAnomalyService } from '../anomaly/temporal-anomaly.service';
import { Finding, SEVERITY_ORDER, SEVERITY_WEIGHT, Severity } from './finding.types';

@Injectable()
export class RiskScoringService {
  private readonly logger = new Logger(RiskScoringService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(EntityMatch) private readonly matches: Repository<EntityMatch>,
    private readonly anomaly: AnomalyDetectionService,
    private readonly addressAnalysis: AddressAnalysisService,
    private readonly ownershipCycle: OwnershipCycleService,
    private readonly community: CommunityDetectionService,
    private readonly temporal: TemporalAnomalyService,
  ) {}

  async run(investigationId: string): Promise<{ score: number; findings: Finding[] }> {
    // Run all analyzers (some already persist to nodes)
    await this.anomaly.scoreShellCompanies(investigationId);
    await this.addressAnalysis.analyze(investigationId);
    const cycles = await this.ownershipCycle.detect(investigationId);
    const { communities, bridges } = await this.community.detect(investigationId);
    const temporal = await this.temporal.detect(investigationId);

    const nodes = await this.nodes.find({ where: { investigationId } });
    const matches = await this.matches.find({ where: { investigationId } });

    const findings: Finding[] = [];

    // Shell company findings
    for (const n of nodes) {
      const shell = n.metadata?.shellCompanyScore;
      if (shell?.risk === 'HIGH') {
        findings.push({
          type: 'shell_company',
          severity: 'HIGH',
          title: `Shell company indicators: ${n.label}`,
          description: `Multi-factor shell-company score of ${shell.score} indicates high likelihood of being a shell entity.`,
          evidence: shell.reasons || [],
          affectedEntities: [n.entityId],
          recommendation: 'Investigate filings, beneficial ownership, and economic substance.',
        });
      } else if (shell?.risk === 'MEDIUM') {
        findings.push({
          type: 'shell_company',
          severity: 'MEDIUM',
          title: `Possible shell company: ${n.label}`,
          description: `Score ${shell.score}. Some shell-company signals present.`,
          evidence: shell.reasons || [],
          affectedEntities: [n.entityId],
          recommendation: 'Review director portfolio and filings.',
        });
      }
    }

    // Address findings
    for (const n of nodes) {
      const a = n.metadata?.addressAnalysis;
      if (a?.flag === 'VIRTUAL_OFFICE') {
        findings.push({
          type: 'virtual_office',
          severity: 'HIGH',
          title: `Virtual office address`,
          description: `${a.density} companies registered at this address (dissolution rate ${(a.dissolutionRate * 100).toFixed(0)}%).`,
          evidence: [`Address: ${n.label}`, `Density: ${a.density}`, `Dissolved: ${a.dissolved}`],
          affectedEntities: [n.entityId],
          recommendation: 'Investigate companies registered at this address for shared control.',
        });
      } else if (a?.flag === 'HIGH_DENSITY') {
        findings.push({
          type: 'high_density_address',
          severity: 'MEDIUM',
          title: `High-density address`,
          description: `${a.density} companies registered at this address.`,
          evidence: [`Address: ${n.label}`, `Density: ${a.density}`],
          affectedEntities: [n.entityId],
          recommendation: 'Cross-reference with other companies sharing the address.',
        });
      }
    }

    // Circular ownership
    for (const cycle of cycles) {
      findings.push({
        type: 'circular_ownership',
        severity: 'CRITICAL',
        title: 'Circular ownership detected',
        description: `Ownership loop spanning ${cycle.labels.length} entities.`,
        evidence: [cycle.labels.join(' → ') + ' → ' + cycle.labels[0]],
        affectedEntities: cycle.nodeIds,
        recommendation: 'Trace ultimate beneficial owner; circular ownership is a strong obfuscation signal.',
      });
    }

    // Bridge nodes
    for (const b of bridges.slice(0, 5)) {
      findings.push({
        type: 'bridge_node',
        severity: 'MEDIUM',
        title: `Bridge person: ${b.label}`,
        description: `Connects ${b.bridgesCommunities.length} otherwise-separate clusters.`,
        evidence: [`Betweenness proxy: ${b.betweenness}`, `Communities bridged: ${b.bridgesCommunities.length}`],
        affectedEntities: [b.nodeId],
        recommendation: 'Investigate role; bridge persons often coordinate distinct schemes.',
      });
    }

    // Temporal
    for (const m of temporal.massIncorporation) {
      findings.push({
        type: 'mass_incorporation',
        severity: 'MEDIUM',
        title: `Mass incorporation: ${m.companyIds.length} companies`,
        description: `${m.companyIds.length} companies incorporated between ${m.windowStart} and ${m.windowEnd}.`,
        evidence: [`Window: ${m.windowStart} → ${m.windowEnd}`, `Companies: ${m.companyIds.length}`],
        affectedEntities: m.companyIds,
        recommendation: 'Coordinated incorporation windows often indicate templated structures.',
      });
    }
    for (const m of temporal.massDissolution) {
      findings.push({
        type: 'mass_dissolution',
        severity: 'HIGH',
        title: `Mass dissolution: ${m.companyIds.length} companies`,
        description: `${m.companyIds.length} companies dissolved between ${m.windowStart} and ${m.windowEnd}.`,
        evidence: [`Window: ${m.windowStart} → ${m.windowEnd}`],
        affectedEntities: m.companyIds,
        recommendation: 'Coordinated dissolutions often follow regulatory or enforcement events.',
      });
    }
    for (const r of temporal.rapidDissolution) {
      findings.push({
        type: 'rapid_dissolution',
        severity: 'MEDIUM',
        title: `Rapid dissolution: ${r.label}`,
        description: `Company existed for only ${r.lifespanMonths} months.`,
        evidence: [`Lifespan: ${r.lifespanMonths} months`],
        affectedEntities: [r.companyId],
        recommendation: 'Short lifespan can indicate transactional or single-purpose entity.',
      });
    }
    for (const p of temporal.preEventResignations) {
      findings.push({
        type: 'resignation_cluster',
        severity: 'MEDIUM',
        title: `Resignation cluster: ${p.label}`,
        description: `${p.resignations} director resignations within ${p.windowDays} days.`,
        evidence: [`Resignations: ${p.resignations}`, `Window: ${p.windowDays} days`],
        affectedEntities: [p.personId],
        recommendation: 'Investigate what event preceded the resignations.',
      });
    }

    // Sanctions matches + proximity
    for (const m of matches) {
      const sev: Severity = m.confidenceScore > 75 ? 'CRITICAL' : 'HIGH';
      findings.push({
        type: 'sanctions_match',
        severity: sev,
        title: `${m.matchedSource === 'opensanctions' ? 'OpenSanctions' : 'ICIJ'} match (${m.confidenceScore}%)`,
        description: `Entity matched against ${m.matchedSource} with ${m.confidenceScore}% confidence.`,
        evidence: Object.entries(m.matchReasons || {}).map(([k, v]) => `${k}: ${v}`),
        affectedEntities: [m.sourceEntityId],
        recommendation:
          sev === 'CRITICAL'
            ? 'Immediate review required; halt onboarding/transactions pending verification.'
            : 'Verify match; document review and decision.',
      });
    }

    // Proximity-based findings (proximity already on nodes)
    for (const n of nodes) {
      if (n.proximityScore === 'HIGH' && n.proximityHops === 1) {
        findings.push({
          type: 'sanctions_proximity',
          severity: 'HIGH',
          title: `One hop from sanctioned entity: ${n.label}`,
          description: 'Direct connection to a sanctioned entity through the network.',
          evidence: [`Proximity hops: ${n.proximityHops}`],
          affectedEntities: [n.entityId],
          recommendation: 'Review nature of the connection; one-hop proximity is a meaningful exposure.',
        });
      }
    }

    // Sort by severity then by title
    findings.sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return s !== 0 ? s : a.title.localeCompare(b.title);
    });

    const score = this.aggregateScore(findings);

    await this.investigations.update(investigationId, {
      progress: { ...(await this.getProgress(investigationId)), riskScore: score, findings, communities: communities.length, bridges: bridges.length } as any,
    });

    this.logger.log(`Risk scoring complete for ${investigationId}: score=${score} findings=${findings.length}`);
    return { score, findings };
  }

  aggregateScore(findings: Finding[]): number {
    let total = 0;
    for (const f of findings) total += SEVERITY_WEIGHT[f.severity];
    return Math.min(100, total);
  }

  private async getProgress(investigationId: string): Promise<Record<string, any>> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    return inv?.progress || {};
  }
}
