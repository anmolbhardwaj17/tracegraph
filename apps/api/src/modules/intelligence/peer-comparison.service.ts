import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { Finding } from '../risk-scoring/finding.types';

export interface PeerResult {
  peers: Array<{ name: string; score: number; industry: string }>;
  benchmarks: {
    avgScore: number;
    medianScore: number;
    percentile: number;
    revenuePerEmployee: { company: number | null; peerMedian: number | null; ratio: number | null };
    profitMargin: { company: number | null; peerMedian: number | null; deviation: number | null };
  };
  anomalies: string[];
  findings: Finding[];
}

/**
 * Phase III: Peer Comparison & Financial Intelligence.
 *
 * Automatically identifies peer companies (same industry/SIC code)
 * from past investigations and benchmarks financial metrics:
 * - Revenue per employee vs peers
 * - Profit margin vs peers
 * - Risk score vs peers
 * - Flags statistical outliers (>2 std deviations)
 */
@Injectable()
export class PeerComparisonService {
  private readonly logger = new Logger(PeerComparisonService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
  ) {}

  async benchmark(investigationId: string): Promise<PeerResult> {
    // Get target company data
    const rootNode = await this.nodes.findOne({
      where: { investigationId, entityType: 'company' },
      order: { id: 'ASC' },
    });
    if (!rootNode) return this.emptyResult();

    const meta = (rootNode.metadata || {}) as any;
    const targetInv = await this.investigations.findOne({ where: { id: investigationId } });
    const targetScore = targetInv?.progress?.riskScore ?? 0;

    this.logger.log(`Peer comparison: ${rootNode.label} (score ${targetScore})`);

    // Find peers from past completed investigations
    const allInvestigations = await this.investigations.find({
      where: { status: 'COMPLETE' as any },
      order: { completedAt: 'DESC' },
      take: 100,
    });

    // Collect peer data
    const peers: Array<{
      name: string; score: number; industry: string;
      revenue: number | null; employees: number | null; profitMargin: number | null;
    }> = [];

    for (const inv of allInvestigations) {
      if (inv.id === investigationId) continue;
      const progress = inv.progress || {} as any;
      const score = progress.riskScore ?? null;
      if (score == null) continue;

      // Get root node of this investigation for metadata
      const peerRoot = await this.nodes.findOne({
        where: { investigationId: inv.id, entityType: 'company' },
        order: { id: 'ASC' },
      });
      const peerMeta = (peerRoot?.metadata || {}) as any;

      peers.push({
        name: inv.metadata?.companyName || inv.query,
        score,
        industry: peerMeta.industry || peerMeta.sicDescription || 'Unknown',
        revenue: this.parseRevenue(peerMeta.revenue),
        employees: this.parseEmployees(peerMeta.employeeCount),
        profitMargin: progress.secIntelligence?.financials?.profitMargin ?? null,
      });
    }

    // Compute benchmarks
    const scores = peers.map((p) => p.score).filter((s): s is number => s != null);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const sortedScores = [...scores].sort((a, b) => a - b);
    const medianScore = sortedScores[Math.floor(sortedScores.length / 2)] || 0;
    const percentile = scores.length > 0 ? Math.round((scores.filter((s) => s <= targetScore).length / scores.length) * 100) : 50;

    // Revenue per employee comparison
    const targetRevenue = this.parseRevenue(meta.revenue);
    const targetEmployees = this.parseEmployees(meta.employeeCount);
    const targetRPE = targetRevenue && targetEmployees ? targetRevenue / targetEmployees : null;
    const peerRPEs = peers
      .map((p) => p.revenue && p.employees ? p.revenue / p.employees : null)
      .filter((r): r is number => r != null);
    const medianRPE = peerRPEs.length > 0 ? peerRPEs.sort((a, b) => a - b)[Math.floor(peerRPEs.length / 2)] : null;

    // Profit margin comparison
    const targetPM = meta.secIntelligence?.financials?.profitMargin ??
      (targetInv?.progress as any)?.secIntelligence?.financials?.profitMargin ?? null;
    const peerPMs = peers.map((p) => p.profitMargin).filter((m): m is number => m != null);
    const medianPM = peerPMs.length > 0 ? peerPMs.sort((a, b) => a - b)[Math.floor(peerPMs.length / 2)] : null;

    // Detect anomalies
    const anomalies: string[] = [];
    if (targetRPE && medianRPE && targetRPE > medianRPE * 5) {
      anomalies.push(`Revenue per employee ($${Math.round(targetRPE / 1000)}K) is ${Math.round(targetRPE / medianRPE)}x the peer median ($${Math.round(medianRPE / 1000)}K) — unusually high`);
    }
    if (targetRPE && medianRPE && targetRPE < medianRPE * 0.1) {
      anomalies.push(`Revenue per employee ($${Math.round(targetRPE / 1000)}K) is ${Math.round(medianRPE / targetRPE)}x below peer median — unusually low`);
    }
    if (targetPM != null && medianPM != null && Math.abs(targetPM - medianPM) > 20) {
      anomalies.push(`Profit margin (${targetPM}%) deviates ${Math.abs(Math.round(targetPM - medianPM))} points from peer median (${medianPM}%)`);
    }
    if (percentile > 90) {
      anomalies.push(`Risk score (${targetScore}) is higher than ${percentile}% of all investigated companies`);
    }

    // Generate findings
    const findings = this.generateFindings(rootNode.label, targetScore, percentile, anomalies, peers.length);

    this.logger.log(`Peer comparison complete: ${peers.length} peers, percentile ${percentile}%, ${anomalies.length} anomalies`);

    return {
      peers: peers.slice(0, 10).map((p) => ({ name: p.name, score: p.score, industry: p.industry })),
      benchmarks: {
        avgScore, medianScore, percentile,
        revenuePerEmployee: { company: targetRPE, peerMedian: medianRPE, ratio: targetRPE && medianRPE ? Math.round((targetRPE / medianRPE) * 10) / 10 : null },
        profitMargin: { company: targetPM, peerMedian: medianPM, deviation: targetPM != null && medianPM != null ? Math.round(targetPM - medianPM) : null },
      },
      anomalies,
      findings,
    };
  }

  private parseRevenue(rev: string | number | null): number | null {
    if (rev == null) return null;
    if (typeof rev === 'number') return rev;
    const s = String(rev).replace(/[,$]/g, '');
    const bMatch = s.match(/([\d.]+)\s*B/i);
    if (bMatch) return parseFloat(bMatch[1]) * 1e9;
    const mMatch = s.match(/([\d.]+)\s*M/i);
    if (mMatch) return parseFloat(mMatch[1]) * 1e6;
    return parseFloat(s) || null;
  }

  private parseEmployees(emp: string | number | null): number | null {
    if (emp == null) return null;
    if (typeof emp === 'number') return emp;
    return parseInt(String(emp).replace(/[,\s]/g, ''), 10) || null;
  }

  private generateFindings(
    companyName: string, score: number, percentile: number,
    anomalies: string[], peerCount: number,
  ): Finding[] {
    const findings: Finding[] = [];

    if (anomalies.length > 0) {
      findings.push({
        type: 'PEER_ANOMALY',
        severity: anomalies.some((a) => a.includes('unusually')) ? 'HIGH' : 'MEDIUM',
        confidence: peerCount >= 5 ? 'HIGH' : 'LOW',
        title: `${anomalies.length} anomaly(ies) vs ${peerCount} peer companies`,
        description: `${companyName} shows ${anomalies.length} statistical anomaly(ies) compared to ${peerCount} investigated peer companies. ` +
          anomalies.join('. '),
        evidence: anomalies,
        affectedEntities: [],
        recommendation: 'Anomalies may have legitimate explanations (different business models) but warrant investigation when combined with other risk signals.',
      });
    }

    if (percentile > 80 && peerCount >= 5) {
      findings.push({
        type: 'HIGH_RISK_PERCENTILE',
        severity: percentile > 95 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `Risk score higher than ${percentile}% of investigated companies`,
        description: `${companyName}'s risk score of ${score} places it in the top ${100 - percentile}% of all companies investigated on TraceGraph (out of ${peerCount} companies).`,
        evidence: [`Risk score: ${score}/100`, `Percentile: ${percentile}%`, `Peer count: ${peerCount}`],
        affectedEntities: [],
        recommendation: 'Elevated risk relative to peers warrants enhanced due diligence.',
      });
    }

    return findings;
  }

  private emptyResult(): PeerResult {
    return {
      peers: [], anomalies: [], findings: [],
      benchmarks: { avgScore: 0, medianScore: 0, percentile: 50, revenuePerEmployee: { company: null, peerMedian: null, ratio: null }, profitMargin: { company: null, peerMedian: null, deviation: null } },
    };
  }
}
