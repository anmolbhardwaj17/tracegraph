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
import { CompanyClassifierService } from '../anomaly/company-classifier.service';
import { DirectorRiskService } from '../anomaly/director-risk.service';
import { FilingHealthService } from '../anomaly/filing-health.service';
import { DisqualifiedDirectorService } from '../anomaly/disqualified-director.service';
import { Finding, SEVERITY_ORDER, classifyOverall } from './finding.types';

@Injectable()
export class RiskScoringService {
  private readonly logger = new Logger(RiskScoringService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(EntityMatch) private readonly matches: Repository<EntityMatch>,
    private readonly classifier: CompanyClassifierService,
    private readonly anomaly: AnomalyDetectionService,
    private readonly addressAnalysis: AddressAnalysisService,
    private readonly ownershipCycle: OwnershipCycleService,
    private readonly community: CommunityDetectionService,
    private readonly temporal: TemporalAnomalyService,
    private readonly directorRisk: DirectorRiskService,
    private readonly filingHealth: FilingHealthService,
    private readonly disqualifiedDirectors: DisqualifiedDirectorService,
  ) {}

  async run(investigationId: string): Promise<{ score: number; findings: Finding[] }> {
    // Order matters: classify first so downstream services can read companyProfile
    await this.classifier.classifyAll(investigationId);
    await this.addressAnalysis.analyze(investigationId);
    await this.directorRisk.profileAll(investigationId);
    await this.anomaly.scoreShellCompanies(investigationId);
    const filingHealthResult = await this.filingHealth.analyze(investigationId);
    const disqualifiedResult = await this.disqualifiedDirectors.checkAll(investigationId);
    const cycles = await this.ownershipCycle.detect(investigationId);
    const { communities, bridges } = await this.community.detect(investigationId);
    const temporal = await this.temporal.detect(investigationId);

    const nodes = await this.nodes.find({ where: { investigationId } });
    const matches = await this.matches.find({ where: { investigationId } });

    const findings: Finding[] = [];

    // ---- SHELL NETWORKS (per-company) ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const shell = n.metadata?.shellCompanyScore;
      if (!shell || shell.risk === 'LOW') continue;
      const sev = shell.risk === 'CRITICAL' ? 'CRITICAL' : shell.risk === 'HIGH' ? 'HIGH' : 'MEDIUM';
      const profileLabel = (n.metadata?.companyProfile || 'UNKNOWN').replace(/_/g, ' ').toLowerCase();
      findings.push({
        type: 'SHELL_NETWORK',
        severity: sev,
        confidence: shell.score >= 60 ? 'HIGH' : shell.score >= 40 ? 'MEDIUM' : 'LOW',
        title: `${n.label} shows ${shell.risk.toLowerCase()} shell-company indicators`,
        description: `${n.label} (${profileLabel}) scored ${shell.score} against shell-company heuristics. Multiple converging signals suggest the entity may exist primarily as a corporate vehicle rather than a trading business.`,
        evidence: shell.reasons || [],
        affectedEntities: [n.entityId],
        recommendation: 'Verify trading activity, beneficial ownership, and economic substance before transacting.',
      });
    }

    // ---- VIRTUAL OFFICE / FORMATION AGENT ADDRESSES ----
    for (const n of nodes) {
      if (n.entityType !== 'address') continue;
      const a = n.metadata?.addressAnalysis;
      if (!a) continue;
      if (a.classification === 'FORMATION_AGENT' || a.classification === 'VIRTUAL_OFFICE') {
        const sev = a.classification === 'FORMATION_AGENT' ? 'HIGH' : 'HIGH';
        findings.push({
          type: 'VIRTUAL_OFFICE_CLUSTER',
          severity: sev,
          confidence: a.density >= 30 ? 'HIGH' : 'MEDIUM',
          title: `${a.density} companies share ${truncate(n.label, 60)}`,
          description: `Address classified as ${a.classification.replace('_', ' ').toLowerCase()}. Hosts ${a.density} companies in this network with a ${(a.dissolutionRate * 100).toFixed(0)}% dissolution rate.`,
          evidence: [
            `Density: ${a.density} companies`,
            `Dissolved: ${a.dissolved}`,
            `Dissolution rate: ${(a.dissolutionRate * 100).toFixed(0)}%`,
            ...(a.averageLifespanYears != null ? [`Avg lifespan: ${a.averageLifespanYears.toFixed(1)} years`] : []),
          ],
          affectedEntities: [n.entityId],
          recommendation: 'Cross-reference companies sharing this address; treat as a single risk cluster.',
        });
      }
    }

    // ---- DIRECTOR NOMINEE / FORMATION AGENT ----
    for (const n of nodes) {
      if (n.entityType !== 'person') continue;
      const dp = n.metadata?.directorProfile;
      if (!dp) continue;
      if (dp.risk === 'NOMINEE_PATTERN' || dp.risk === 'FORMATION_AGENT') {
        const sev = dp.risk === 'FORMATION_AGENT' ? 'CRITICAL' : 'HIGH';
        findings.push({
          type: 'DIRECTOR_NOMINEE_PATTERN',
          severity: sev,
          confidence: 'HIGH',
          title: `${n.label} matches ${dp.risk.replace('_', ' ').toLowerCase()} profile`,
          description: `${n.label} holds ${dp.totalAppointments} director appointments — ${dp.active} active, ${dp.dissolved} dissolved (${(dp.dissolvedRatio * 100).toFixed(0)}% dissolved). ${dp.microOnly ? 'All micro/dormant entities. ' : ''}Operating from ${dp.uniqueAddresses} address(es).`,
          evidence: [
            `Appointments: ${dp.totalAppointments}`,
            `Dissolved ratio: ${(dp.dissolvedRatio * 100).toFixed(0)}%`,
            ...(dp.averageLifespanYears !== null ? [`Avg company lifespan: ${dp.averageLifespanYears.toFixed(1)} years`] : []),
            `Unique addresses: ${dp.uniqueAddresses}`,
            `Industries: ${dp.uniqueSics}`,
            ...(dp.reasons || []),
          ],
          affectedEntities: [n.entityId],
          recommendation: 'Identify the ultimate beneficial owner; nominee directors typically front other parties.',
        });
      }
    }

    // ---- CIRCULAR OWNERSHIP ----
    for (const cycle of cycles) {
      findings.push({
        type: 'CIRCULAR_OWNERSHIP',
        severity: 'CRITICAL',
        confidence: 'HIGH',
        title: `Circular ownership: ${cycle.labels.join(' → ')} → ${cycle.labels[0]}`,
        description: `${cycle.labels.length}-entity ownership loop detected. This structure obscures the true beneficial owner.`,
        evidence: [`Loop: ${cycle.labels.join(' → ')} → ${cycle.labels[0]}`],
        affectedEntities: cycle.nodeIds,
        recommendation: 'Trace ultimate beneficial owner manually; circular structures are a strong obfuscation signal.',
      });
    }

    // ---- BRIDGE PERSONS ----
    for (const b of bridges.slice(0, 5)) {
      findings.push({
        type: 'BRIDGE_PERSON',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${b.label} bridges ${b.bridgesCommunities.length} otherwise-separate clusters`,
        description: `${b.label} appears in ${b.bridgesCommunities.length} distinct sub-networks within this investigation, making them a coordinator-style node.`,
        evidence: [
          `Clusters bridged: ${b.bridgesCommunities.length}`,
          `Betweenness proxy: ${b.betweenness}`,
        ],
        affectedEntities: [b.nodeId],
        recommendation: 'Investigate role; coordinators often link otherwise-separate schemes.',
      });
    }

    // ---- TEMPORAL ANOMALIES ----
    for (const m of temporal.massIncorporation) {
      findings.push({
        type: 'MASS_INCORPORATION',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${m.companyIds.length} companies incorporated in ${dateRangeDays(m.windowStart, m.windowEnd)} days`,
        description: `${m.companyIds.length} companies in this network were incorporated between ${m.windowStart} and ${m.windowEnd}, suggesting coordinated creation.`,
        evidence: [`Window: ${m.windowStart} → ${m.windowEnd}`, `Companies: ${m.companyIds.length}`],
        affectedEntities: m.companyIds,
        recommendation: 'Burst incorporations often indicate templated structures or pre-positioned entities.',
      });
    }
    for (const m of temporal.massDissolution) {
      findings.push({
        type: 'MASS_DISSOLUTION',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `${m.companyIds.length} companies dissolved in ${dateRangeDays(m.windowStart, m.windowEnd)} days`,
        description: `${m.companyIds.length} companies in this network were dissolved between ${m.windowStart} and ${m.windowEnd}.`,
        evidence: [`Window: ${m.windowStart} → ${m.windowEnd}`],
        affectedEntities: m.companyIds,
        recommendation: 'Coordinated dissolutions often follow regulatory or enforcement events.',
      });
    }
    for (const r of temporal.rapidDissolution) {
      findings.push({
        type: 'RAPID_DISSOLUTION',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${r.label} existed only ${r.lifespanMonths} months`,
        description: `${r.label} was incorporated and dissolved within ${r.lifespanMonths} months — typical of single-purpose vehicles.`,
        evidence: [`Lifespan: ${r.lifespanMonths} months`],
        affectedEntities: [r.companyId],
        recommendation: 'Identify the underlying transaction this entity was created to conduct.',
      });
    }
    for (const p of temporal.preEventResignations) {
      findings.push({
        type: 'RESIGNATION_CLUSTER',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${p.label}: ${p.resignations} resignations in ${p.windowDays} days`,
        description: `${p.label} resigned from ${p.resignations} directorships within a ${p.windowDays}-day window.`,
        evidence: [`Resignations: ${p.resignations}`, `Window: ${p.windowDays} days`],
        affectedEntities: [p.personId],
        recommendation: 'Identify what event preceded the resignations.',
      });
    }

    // ---- SANCTIONS MATCHES ----
    for (const m of matches) {
      const sev = m.confidenceScore > 80 ? 'CRITICAL' : m.confidenceScore > 60 ? 'HIGH' : 'MEDIUM';
      const sourceLabel = m.matchedSource === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks';
      const matchedName = m.matchReasons?.matchedName || m.matchedEntityId;
      findings.push({
        type: 'SANCTIONS_PROXIMITY',
        severity: sev,
        confidence: m.confidenceScore > 80 ? 'HIGH' : 'MEDIUM',
        title: `${matchedName} matched on ${sourceLabel} (${m.confidenceScore}%)`,
        description: `Source entity ${m.sourceEntityId} matches ${matchedName} on ${sourceLabel} with ${m.confidenceScore}% confidence.`,
        evidence: Object.entries(m.matchReasons || {}).map(([k, v]) => `${k}: ${v}`),
        affectedEntities: [m.sourceEntityId],
        recommendation:
          sev === 'CRITICAL'
            ? 'Halt onboarding/transactions pending verification of identity and screening.'
            : 'Verify match; document review and decision.',
      });
    }

    // ---- NETWORK PROXIMITY (1-hop only — 0-hop already covered above) ----
    const matchedIds = new Set(matches.map((m) => m.sourceEntityId));
    for (const n of nodes) {
      if (matchedIds.has(n.entityId)) continue; // already a direct match
      if (n.proximityScore === 'HIGH' && n.proximityHops === 1) {
        findings.push({
          type: 'SANCTIONS_PROXIMITY',
          severity: 'HIGH',
          confidence: 'HIGH',
          title: `${n.label} is one hop from a sanctioned entity`,
          description: `Direct connection to a sanctioned or matched entity through the ownership/director graph.`,
          evidence: [`Proximity hops: ${n.proximityHops}`],
          affectedEntities: [n.entityId],
          recommendation: 'Review the nature of the connection; one-hop proximity is a meaningful exposure.',
        });
      }
    }

    // ---- FILING HEALTH FINDINGS ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const fh = n.metadata?.filingHealth;
      if (!fh) continue;
      if (fh.band === 'POOR' || fh.band === 'WEAK') {
        const sev = fh.band === 'POOR' ? 'HIGH' : 'MEDIUM';
        findings.push({
          type: 'FILING_HEALTH',
          severity: sev,
          confidence: fh.totalAccountsFilings >= 3 ? 'HIGH' : 'MEDIUM',
          title: `${n.label} has ${fh.band.toLowerCase()} filing discipline (score ${fh.score})`,
          description: `Filing health analysis flagged ${n.label} with a ${fh.score}/100 score. ${fh.reasons.join('; ') || 'Multiple late or overdue filings.'}`,
          evidence: fh.reasons,
          affectedEntities: [n.entityId],
          recommendation: 'Persistent late filings often precede insolvency, restoration applications, or enforcement.',
        });
      }
    }

    // ---- ACCOUNT TYPE REGRESSION ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const reg = n.metadata?.accountRegression;
      if (!reg?.regressed) continue;
      findings.push({
        type: 'ACCOUNT_REGRESSION',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${n.label} regressed from ${reg.startType} to ${reg.endType} accounts`,
        description: `${n.label}'s filed accounts type has stepped down over time (${reg.history.map((h: any) => h.type).join(' → ')}). Possible revenue suppression or downsizing for filing-exemption thresholds.`,
        evidence: reg.history.map((h: any) => `${h.date}: ${h.type}`),
        affectedEntities: [n.entityId],
        recommendation: 'Compare turnover/employee disclosures to filed exemption thresholds; investigate causes.',
      });
    }

    // ---- DORMANT CYCLING ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const dc = n.metadata?.dormantCycle;
      if (!dc?.oscillating) continue;
      findings.push({
        type: 'DORMANT_CYCLING',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `${n.label} oscillates between dormant and active`,
        description: `${n.label} has filed dormant accounts then active accounts then dormant again ${dc.transitions} times. This pattern is consistent with intermittent activation for transaction-specific use.`,
        evidence: dc.history.map((h: any) => `${h.date}: ${h.type}`),
        affectedEntities: [n.entityId],
        recommendation: 'Examine activity windows; align with known transactions or asset movements.',
      });
    }

    // ---- DISQUALIFIED DIRECTORS ----
    for (const m of disqualifiedResult) {
      const top = m.matches[0];
      findings.push({
        type: 'DISQUALIFIED_DIRECTOR',
        severity: 'CRITICAL',
        confidence: top.confidence >= 90 ? 'HIGH' : top.confidence >= 80 ? 'MEDIUM' : 'LOW',
        title: `${m.personName} matches a disqualified UK director (${top.confidence}%)`,
        description: `${m.personName} fuzzy-matches "${top.matchedName}" on the Companies House disqualified-officers register${top.fromDate ? `, disqualified from ${top.fromDate}${top.toDate ? ` to ${top.toDate}` : ''}` : ''}.${top.reason ? ` Reason: ${top.reason}.` : ''}${top.isUndertaking ? ' (undertaking)' : ''}`,
        evidence: [
          `Confidence: ${top.confidence}%`,
          `Matched name: ${top.matchedName}`,
          ...(top.fromDate ? [`Disqualified from: ${top.fromDate}`] : []),
          ...(top.toDate ? [`Disqualified until: ${top.toDate}`] : []),
          ...(top.reason ? [`Reason: ${top.reason}`] : []),
          ...(top.caseRef ? [`Case ref: ${top.caseRef}`] : []),
          ...(top.addressLine ? [`Address on register: ${top.addressLine}`] : []),
          ...(m.matches.length > 1 ? [`+${m.matches.length - 1} other potential match(es)`] : []),
        ],
        affectedEntities: [m.personNodeId],
        recommendation: 'Verify identity against CH disqualification record before relying on this person as a director or controller. Disqualified persons cannot lawfully act in the management of a UK company.',
      });
    }

    // ---- PHOENIX PATTERN ----
    for (const p of filingHealthResult.phoenixPairs) {
      findings.push({
        type: 'PHOENIX_COMPANY',
        severity: 'HIGH',
        confidence: p.sharedAddress && p.similarSic ? 'HIGH' : 'MEDIUM',
        title: `Phoenix pattern: ${p.successorLabel} replaced ${p.predecessorLabel}`,
        description: `${p.predecessorLabel} dissolved and ${p.successorLabel} incorporated within ${p.daysBetween} days, sharing ${p.sharedDirectors.length} director(s)${p.sharedAddress ? ', the registered address' : ''}${p.similarSic ? ', and SIC codes' : ''}.`,
        evidence: [
          `Days between: ${p.daysBetween}`,
          `Shared directors: ${p.sharedDirectors.join(', ')}`,
          `Shared address: ${p.sharedAddress ? 'yes' : 'no'}`,
          `Similar SIC: ${p.similarSic ? 'yes' : 'no'}`,
        ],
        affectedEntities: [p.predecessorCompanyId, p.successorCompanyId],
        recommendation: 'Phoenix patterns are commonly used to shed liabilities and restart trading; review motive.',
      });
    }

    // ---- SORT findings ----
    findings.sort((a, b) => {
      const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      return s !== 0 ? s : a.title.localeCompare(b.title);
    });

    // ---- COMPONENT-BASED SCORE ----
    const breakdown = this.calculateScoreBreakdown({
      matches,
      nodes,
      cycles,
      temporal,
    });
    const score = breakdown.total;

    await this.investigations.update(investigationId, {
      progress: {
        ...(await this.getProgress(investigationId)),
        riskScore: score,
        riskClassification: classifyOverall(score),
        scoreBreakdown: breakdown,
        findings,
        communities: communities.length,
        bridges: bridges.length,
      } as any,
    });

    this.logger.log(`Risk scoring complete for ${investigationId}: score=${score} (${classifyOverall(score)}) findings=${findings.length}`);
    return { score, findings };
  }

  /** Backwards-compat: total only. */
  calculateScore(data: { matches: EntityMatch[]; nodes: GraphNode[]; cycles: any[]; temporal: any }): number {
    return this.calculateScoreBreakdown(data).total;
  }

  /** Component-based 0-100 score: sanctions (40) + structural (35) + director (25). */
  calculateScoreBreakdown(data: { matches: EntityMatch[]; nodes: GraphNode[]; cycles: any[]; temporal: any }): { sanctions: number; structural: number; director: number; total: number } {
    let sanctions = 0;
    let structural = 0;
    let director = 0;

    // ---- Sanctions component (max 40) ----
    for (const m of data.matches) {
      if (m.matchedSource === 'opensanctions') {
        if (m.confidenceScore > 80) sanctions = Math.max(sanctions, 40);
        else if (m.confidenceScore >= 60) sanctions = Math.max(sanctions, 30);
      } else if (m.matchedSource === 'offshore_leaks') {
        if (m.confidenceScore > 80) sanctions = Math.max(sanctions, 25);
        else if (m.confidenceScore >= 60) sanctions = Math.max(sanctions, 15);
      }
    }
    // Network proximity bumps
    for (const n of data.nodes) {
      if (n.proximityScore === 'HIGH' && n.proximityHops === 1) sanctions = Math.min(40, Math.max(sanctions, 20));
      if (n.proximityScore === 'MEDIUM' && n.proximityHops === 2) sanctions = Math.min(40, Math.max(sanctions, 10));
    }

    // ---- Structural component (max 35) ----
    if (data.cycles.length > 0) structural += 25;
    // Shell network pattern: any company with HIGH/CRITICAL shell on a SMALL/MICRO/NEWLY profile
    const shellNetworkPresent = data.nodes.some((n) => {
      if (n.entityType !== 'company') return false;
      const sc = n.metadata?.shellCompanyScore;
      const profile = n.metadata?.companyProfile;
      return (sc?.risk === 'HIGH' || sc?.risk === 'CRITICAL') &&
        (profile === 'SMALL_PRIVATE' || profile === 'MICRO_ENTITY' || profile === 'NEWLY_FORMED');
    });
    if (shellNetworkPresent) structural += 20;
    const formationAgentPresent = data.nodes.some((n) =>
      n.entityType === 'address' && n.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT',
    );
    if (formationAgentPresent) structural += 10;
    if (data.temporal?.massIncorporation?.length > 0) structural += 10;
    if ((data.temporal?.rapidDissolution?.length || 0) >= 2) structural += 8;
    structural = Math.min(35, structural);

    // ---- Director component (max 25) ----
    const formationAgents = data.nodes.filter((n) =>
      n.entityType === 'person' && n.metadata?.directorProfile?.risk === 'FORMATION_AGENT',
    ).length;
    const nominees = data.nodes.filter((n) =>
      n.entityType === 'person' && n.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN',
    ).length;
    if (formationAgents > 0) director += 25;
    else if (nominees > 0) director += 15;
    else {
      // Director with 5+ recent dissolved companies
      const heavyDissolver = data.nodes.some((n) => {
        const dp = n.metadata?.directorProfile;
        return dp && dp.dissolved >= 5;
      });
      if (heavyDissolver) director += 10;
    }
    director = Math.min(25, director);

    const total = Math.min(100, sanctions + structural + director);
    return { sanctions, structural, director, total };
  }

  // Legacy alias kept for any callers
  aggregateScore(findings: Finding[]): number {
    // simple severity-weight sum used by old tests
    const w: Record<string, number> = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3 };
    let total = 0;
    for (const f of findings) total += w[f.severity] || 0;
    return Math.min(100, total);
  }

  private async getProgress(investigationId: string): Promise<Record<string, any>> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    return inv?.progress || {};
  }
}

function dateRangeDays(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / (24 * 60 * 60 * 1000));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
