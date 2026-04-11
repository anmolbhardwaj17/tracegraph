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
import { JurisdictionRiskService } from '../anomaly/jurisdiction-risk.service';
import { CompanyAgeAnomalyService } from '../anomaly/company-age-anomaly.service';
import { CrossDirectorshipService } from '../anomaly/cross-directorship.service';
import { OwnershipOpacityService } from '../anomaly/ownership-opacity.service';
import { DirectorVelocityService } from '../anomaly/director-velocity.service';
import { FinancialDistressService } from '../anomaly/financial-distress.service';
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
    private readonly jurisdictionRisk: JurisdictionRiskService,
    private readonly companyAge: CompanyAgeAnomalyService,
    private readonly crossDirectorship: CrossDirectorshipService,
    private readonly ownershipOpacity: OwnershipOpacityService,
    private readonly directorVelocity: DirectorVelocityService,
    private readonly financialDistress: FinancialDistressService,
  ) {}

  async run(
    investigationId: string,
    onStep?: (step: string, detail?: string) => void,
  ): Promise<{ score: number; findings: Finding[] }> {
    const emit = onStep || (() => {});

    emit('Classifying companies', 'Profiling company types and address clusters');
    await this.classifier.classifyAll(investigationId);
    await this.addressAnalysis.analyze(investigationId);

    emit('Profiling directors', 'Analyzing appointment patterns and portfolio risk');
    await this.directorRisk.profileAll(investigationId, (done, total) => {
      emit('Profiling directors', `${done.toLocaleString()} of ${total.toLocaleString()} directors`);
    });

    emit('Shell company scoring', 'Detecting shell indicators across the network');
    await this.anomaly.scoreShellCompanies(investigationId);

    emit('Filing health analysis', 'Checking filing history, late accounts, phoenix patterns');
    const filingHealthResult = await this.filingHealth.analyze(investigationId);

    emit('Disqualified director screening', 'Searching CH disqualified-officers register');
    const disqualifiedResult = await this.disqualifiedDirectors.checkAll(investigationId);

    emit('Jurisdiction risk tagging', 'Classifying jurisdictions across the network');
    const existingProgress = await this.getProgress(investigationId);
    const uboChains: any[] = (existingProgress as any).uboChains || [];
    const jurisdictionResult = await this.jurisdictionRisk.tagAll(investigationId, uboChains);

    emit('Company age anomalies', 'Shelf purchases, mass formations, filing gaps');
    const ageAnomalies = await this.companyAge.detect(investigationId);

    emit('Cross-directorship conflicts', 'SIC conflicts, incestuous networks, dual-sided directors');
    const crossDir = await this.crossDirectorship.analyze(investigationId);

    emit('Ownership opacity analysis', 'Scoring beneficial ownership transparency');
    await this.ownershipOpacity.scoreAll(investigationId, uboChains);

    emit('Director velocity scoring', 'Analyzing appointment patterns and churn rates');
    await this.directorVelocity.scoreAll(investigationId);

    emit('Financial distress analysis', 'Checking company accounts for distress signals');
    await this.financialDistress.analyze(investigationId);
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

    // ---- HIGH-RISK JURISDICTIONS ----
    for (const n of nodes) {
      const jr = n.metadata?.jurisdictionRisk;
      if (!jr || jr.risk !== 'HIGH') continue;
      findings.push({
        type: 'HIGH_RISK_JURISDICTION',
        severity: n.entityType === 'company' ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `${n.label} sits in ${jr.matched || jr.raw} (high-risk jurisdiction)`,
        description: `${n.label} is registered in ${jr.matched || jr.raw}, a jurisdiction known for opaque ownership, weak beneficial-owner disclosure, or historical use in concealment structures.`,
        evidence: [`Jurisdiction: ${jr.matched || jr.raw}`, `Risk band: HIGH`],
        affectedEntities: [n.entityId],
        recommendation: 'Apply enhanced due-diligence; demand evidence of economic substance, real-world activity, and identifiable beneficial owners.',
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

    // ---- SAME-SIC COMPETITOR CONFLICT ----
    for (const c of crossDir.sameSicConflicts) {
      findings.push({
        type: 'SAME_SIC_CONFLICT',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${c.directorLabel} directs ${c.companyLabels.length} companies in SIC ${c.sicCode}`,
        description: `${c.directorLabel} holds director positions at ${c.companyLabels.length} companies sharing SIC code ${c.sicCode}, which may indicate a competitor-conflict or coordinated sector play.`,
        evidence: [
          `SIC: ${c.sicCode}`,
          `Companies: ${c.companyLabels.join(', ')}`,
        ],
        affectedEntities: [c.directorId, ...c.companyIds],
        recommendation: 'Assess whether companies are genuinely related (group structure) or competing entities with a conflicted director.',
      });
    }

    // ---- INCESTUOUS DIRECTOR NETWORKS ----
    for (const n of crossDir.incestuousNetworks) {
      findings.push({
        type: 'INCESTUOUS_NETWORK',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${n.personLabels.length} people cross-direct ${n.companyIds.length} companies (density ${n.density})`,
        description: `A tight clique of ${n.personLabels.length} directors (${n.personLabels.join(', ')}) collectively serve across ${n.companyIds.length} companies. The density of ${n.density} companies per person suggests a circular appointment pattern where the same people keep appointing each other.`,
        evidence: [
          `Directors: ${n.personLabels.join(', ')}`,
          `Companies: ${n.companyIds.length}`,
          `Density: ${n.density} companies/person`,
        ],
        affectedEntities: [...n.personIds, ...n.companyIds.slice(0, 10)],
        recommendation: 'Treat the group as a single decision-making unit. Look for cross-guarantees, related-party transactions, and aggregate risk exposure.',
      });
    }

    // ---- DUAL-SIDED DIRECTORS ----
    for (const d of crossDir.dualSidedDirectors) {
      for (const pair of d.linkedPairs) {
        findings.push({
          type: 'DUAL_SIDED_DIRECTOR',
          severity: 'MEDIUM',
          confidence: 'MEDIUM',
          title: `${d.directorLabel} sits on both sides of a ${pair.linkType} link`,
          description: `${d.directorLabel} is a director of both ${pair.labelA} and ${pair.labelB}, which are connected by a "${pair.linkType}" relationship. This creates a potential conflict of interest.`,
          evidence: [
            `Company A: ${pair.labelA}`,
            `Company B: ${pair.labelB}`,
            `Relationship type: ${pair.linkType}`,
          ],
          affectedEntities: [d.directorId, pair.companyA, pair.companyB],
          recommendation: 'Identify the nature of the business relationship and whether the director discloses the conflict.',
        });
      }
    }

    // ---- SHELF COMPANY (old dormant + sudden director churn) ----
    for (const s of ageAnomalies.shelfPurchases) {
      findings.push({
        type: 'SHELF_COMPANY_PURCHASE',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `${s.companyLabel} (${s.ageYears}y old) revived after dormancy`,
        description: `${s.companyLabel} has been dormant or filing-inactive for most of its ${s.ageYears}-year history but recently saw ${s.recentDirectorChanges} director appointments / changes. Pattern is consistent with the purchase of a "shelf company" to acquire instant historical credibility.`,
        evidence: s.evidence,
        affectedEntities: [s.companyId],
        recommendation: 'Verify the buyers, the substance of new operations, and any change of beneficial ownership not yet filed.',
      });
    }

    // ---- BRAND-NEW WITH LARGE CHARGES ----
    for (const b of ageAnomalies.brandNewWithCharges) {
      findings.push({
        type: 'NEW_COMPANY_HEAVY_CHARGES',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${b.companyLabel} has ${b.chargeCount} charge(s) at ${b.ageDays} days old`,
        description: `${b.companyLabel} was incorporated only ${b.ageDays} days ago but already has ${b.chargeCount} registered charge${b.chargeCount === 1 ? '' : 's'} (mortgages / debentures). Newly-formed companies don't normally take on secured debt this quickly.`,
        evidence: [
          `Age: ${b.ageDays} days`,
          `Charges: ${b.chargeCount}`,
        ],
        affectedEntities: [b.companyId],
        recommendation: 'Inspect each charge: lender identity, instrument type, and what asset is secured. Common in asset-stripping vehicles.',
      });
    }

    // ---- MASS FORMATION EVENT ----
    for (const m of ageAnomalies.massFormationEvents) {
      findings.push({
        type: 'MASS_FORMATION_EVENT',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${m.directorLabel} incorporated ${m.companyIds.length} companies on ${m.date}`,
        description: `On ${m.date}, ${m.directorLabel} appears as a director of ${m.companyIds.length} companies all incorporated the same day. Single-day mass formation by one individual is consistent with templated structures (formation agents, single-purpose vehicles, layered ownership).`,
        evidence: [
          `Date: ${m.date}`,
          `Companies: ${m.companyIds.length}`,
          `Sample: ${m.companyLabels.slice(0, 5).join(', ')}${m.companyLabels.length > 5 ? '…' : ''}`,
        ],
        affectedEntities: [m.directorId, ...m.companyIds],
        recommendation: 'Treat the cluster as a single risk unit; investigate the controlling party behind the mass formation.',
      });
    }

    // ---- MULTI-YEAR FILING GAP REACTIVATION ----
    for (const g of ageAnomalies.filingGapRevivals) {
      findings.push({
        type: 'FILING_GAP_REACTIVATION',
        severity: 'MEDIUM',
        confidence: 'MEDIUM',
        title: `${g.companyLabel} reactivated after a ${g.gapYears}-year filing gap`,
        description: `${g.companyLabel} has a ${g.gapYears}-year gap in its accounts filings, then resumed filing on ${g.resumedAt}. Long gaps followed by reactivation are consistent with repurposing a dormant corporate vehicle.`,
        evidence: [
          `Gap: ${g.gapYears} years`,
          `Resumed: ${g.resumedAt}`,
          ...(g.beforeType ? [`Before: ${g.beforeType}`] : []),
          ...(g.afterType ? [`After: ${g.afterType}`] : []),
        ],
        affectedEntities: [g.companyId],
        recommendation: 'Identify what triggered the reactivation; check for change of beneficial owner or new commercial activity.',
      });
    }

    // ---- FINANCIAL DISTRESS ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const fm = n.metadata?.financialMetrics;
      if (!fm?.distressed) continue;
      findings.push({
        type: 'FINANCIAL_DISTRESS',
        severity: fm.negativeEquity ? 'HIGH' : 'MEDIUM',
        confidence: fm.filings?.length >= 2 ? 'HIGH' : 'MEDIUM',
        title: `${n.label} shows financial distress signals`,
        description: `${n.label} financial analysis: ${fm.reasons.join('. ') || 'Distress indicators detected'}.`,
        evidence: [
          ...(fm.totalAssets != null ? [`Total assets: ${fm.totalAssets.toLocaleString()}`] : []),
          ...(fm.netAssets != null ? [`Net assets: ${fm.netAssets.toLocaleString()}`] : []),
          ...(fm.assetTrend ? [`Asset trend: ${fm.assetTrend}`] : []),
          ...(fm.negativeEquity ? ['Negative equity'] : []),
          ...fm.reasons,
        ],
        affectedEntities: [n.entityId],
        recommendation: 'Review financial statements in detail. Negative equity or rapid asset decline may indicate insolvency risk.',
      });
    }

    // ---- COORDINATED LIFECYCLE ----
    for (const cl of temporal.coordinatedLifecycles || []) {
      findings.push({
        type: 'COORDINATED_LIFECYCLE',
        severity: 'CRITICAL',
        confidence: cl.companyIds.length >= 8 ? 'HIGH' : 'MEDIUM',
        title: `${cl.directorLabel}: ${cl.companyIds.length} companies created and dissolved in coordinated ${cl.lifecycleMonths}-month cycle`,
        description: `${cl.directorLabel} incorporated ${cl.companyIds.length} companies between ${cl.incWindowStart} and ${cl.incWindowEnd}, then dissolved them between ${cl.dissWindowStart} and ${cl.dissWindowEnd}. This ${cl.lifecycleMonths}-month lifecycle is consistent with a coordinated scheme.`,
        evidence: [
          `Companies: ${cl.companyIds.length}`,
          `Incorporation window: ${cl.incWindowStart} to ${cl.incWindowEnd}`,
          `Dissolution window: ${cl.dissWindowStart} to ${cl.dissWindowEnd}`,
          `Lifecycle: ${cl.lifecycleMonths} months`,
          `Sample: ${cl.companyLabels.slice(0, 5).join(', ')}${cl.companyLabels.length > 5 ? '...' : ''}`,
        ],
        affectedEntities: [cl.directorId, ...cl.companyIds],
        recommendation: 'Investigate the underlying transactions during the active period. Pattern strongly suggests single-purpose vehicle recycling.',
      });
    }

    // ---- DIRECTOR VELOCITY ----
    for (const n of nodes) {
      if (n.entityType !== 'person') continue;
      const vel = n.metadata?.directorVelocity;
      if (!vel?.flagged) continue;
      findings.push({
        type: 'DIRECTOR_VELOCITY',
        severity: 'HIGH',
        confidence: vel.totalAppointments >= 10 ? 'HIGH' : 'MEDIUM',
        title: `${n.label}: ${vel.totalAppointments} appointments in ${vel.yearsActive} years, ${vel.resignationRate}% resignation rate`,
        description: `${n.label} shows high directorship velocity: ${vel.appointmentsPerYear} appointments/year, ${vel.resignationRate}% resigned, average tenure ${vel.avgTenureMonths} months. Pattern is consistent with nominee directors or formation agent operatives.`,
        evidence: vel.reasons,
        affectedEntities: [n.entityId],
        recommendation: 'Verify the commercial rationale for the high turnover. Cross-reference with formation agent connections.',
      });
    }

    // ---- OWNERSHIP OPACITY ----
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      const opacity = n.metadata?.ownershipOpacity;
      if (!opacity || opacity.score <= 50) continue;
      findings.push({
        type: 'OWNERSHIP_OPACITY',
        severity: opacity.score >= 75 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `${n.label} has ${opacity.band.toLowerCase().replace('_', ' ')} ownership (opacity ${opacity.score}/100)`,
        description: `Beneficial ownership transparency score: ${opacity.score}/100. ${opacity.reasons.join('. ')}.`,
        evidence: opacity.reasons,
        affectedEntities: [n.entityId],
        recommendation: 'Demand evidence of beneficial ownership before transacting. Opaque ownership structures are a primary money laundering risk indicator.',
      });
    }

    // ---- FORMATION AGENT (informational) ----
    for (const n of nodes) {
      if (n.entityType !== 'company' || !n.metadata?.isFormationAgent) continue;
      // Only emit if this agent is connected to the root company
      findings.push({
        type: 'FORMATION_AGENT',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${n.label} is a known formation agent`,
        description: `${n.label} is a registered company formation service. Connections to this entity indicate companies were incorporated via a formation agent, which is common and not inherently suspicious.`,
        evidence: [`Entity: ${n.label}`, n.entityId ? `Company number: ${n.entityId}` : ''].filter(Boolean),
        affectedEntities: [n.entityId],
        recommendation: 'Formation agent connections are informational. Focus due diligence on the beneficial owners and trading activities of the incorporated companies.',
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
        // Persist (possibly mutated) UBO chains so jurisdictionRisk's
        // crossesHighRisk + appended OFFSHORE flag survive the write
        uboChains,
        jurisdictionRiskSummary: jurisdictionResult,
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
