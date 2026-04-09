import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';

const DAY = 24 * 60 * 60 * 1000;
const FILING_HISTORY_CAP = 30; // Cap CH calls per investigation

export type AccountsType = 'full' | 'medium' | 'small' | 'micro' | 'dormant' | 'unknown';

export interface FilingHealth {
  score: number;          // 0..100, higher = healthier
  band: 'POOR' | 'WEAK' | 'OK' | 'GOOD';
  lateAccountsCount: number;
  veryLateAccountsCount: number;
  totalAccountsFilings: number;
  confirmationOverdue: boolean;
  reasons: string[];
}

export interface AccountTypeRegression {
  /** Sorted oldest → newest. */
  history: { date: string; type: AccountsType }[];
  /** True if monotonically regressed toward smaller (e.g. full → small → micro). */
  regressed: boolean;
  startType?: AccountsType;
  endType?: AccountsType;
}

export interface DormantCycle {
  /** Number of dormant <-> non-dormant transitions detected. */
  transitions: number;
  oscillating: boolean;
  history: { date: string; type: AccountsType }[];
}

export interface PhoenixPair {
  predecessorCompanyId: string;
  predecessorLabel: string;
  successorCompanyId: string;
  successorLabel: string;
  daysBetween: number;
  sharedDirectors: string[];
  sharedAddress: boolean;
  similarSic: boolean;
}

const TYPE_RANK: Record<AccountsType, number> = {
  full: 5,
  medium: 4,
  small: 3,
  micro: 2,
  dormant: 1,
  unknown: 0,
};

function parseAccountsType(description: string | undefined): AccountsType {
  if (!description) return 'unknown';
  const d = description.toLowerCase();
  if (d.includes('dormant')) return 'dormant';
  if (d.includes('micro')) return 'micro';
  if (d.includes('small')) return 'small';
  if (d.includes('medium')) return 'medium';
  if (d.includes('full')) return 'full';
  if (d.includes('group')) return 'full';
  if (d.includes('total-exemption-full')) return 'small';
  if (d.includes('total-exemption-small')) return 'small';
  return 'unknown';
}

@Injectable()
export class FilingHealthService {
  private readonly logger = new Logger(FilingHealthService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly ch: CompaniesHouseService,
  ) {}

  /**
   * For every company in the investigation:
   *   - Compute a basic filing-health score from already-fetched metadata
   *   - For up to FILING_HISTORY_CAP companies, fetch filing history and
   *     compute account-type regression + dormant cycling
   * Then run a cross-company phoenix-pattern scan over graph data only.
   * Persists results onto node.metadata.filingHealth / phoenix.
   */
  async analyze(investigationId: string): Promise<{
    healthCount: number;
    regressedCount: number;
    cyclingCount: number;
    phoenixPairs: PhoenixPair[];
  }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const companies = nodes.filter((n) => n.entityType === 'company');

    let healthCount = 0;
    let regressedCount = 0;
    let cyclingCount = 0;

    // Sort by degree (most central first) — those get the API budget first
    const edges = await this.edges.find({ where: { investigationId } });
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) || 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) || 0) + 1);
    }
    const ranked = [...companies].sort(
      (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0),
    );

    let apiBudget = FILING_HISTORY_CAP;

    for (const c of ranked) {
      const meta = c.metadata || {};
      const reasons: string[] = [];
      const confirmationOverdue = !!meta.confirmationStatementOverdue;
      let score = 100;
      let lateAccountsCount = 0;
      let veryLateAccountsCount = 0;
      let totalAccountsFilings = 0;

      if (confirmationOverdue) {
        score -= 25;
        reasons.push('Confirmation statement overdue');
      }
      if (meta.hasBeenLiquidated) {
        score -= 10;
        reasons.push('Company has been liquidated');
      }
      if (meta.hasInsolvencyHistory) {
        score -= 10;
        reasons.push('Insolvency history on file');
      }

      // Filing history pull (only if budget remains and entity has a valid number)
      let filingHistory: any[] = [];
      if (apiBudget > 0 && c.entityId) {
        try {
          const fh = await this.ch.getFilingHistory(c.entityId);
          filingHistory = fh?.items || [];
          apiBudget--;
        } catch (e: any) {
          // 404s and other failures are non-fatal
        }
      }

      // ---- Late filings: per accounts filing, compare filed-on date vs
      // accounting period end date + 9 months (UK private-co statutory window) ----
      const accountFilings = filingHistory.filter(
        (f) => f.category === 'accounts' || /^accounts/.test(f.type || ''),
      );
      for (const f of accountFilings) {
        totalAccountsFilings++;
        const madeUpTo = f.description_values?.made_up_date || f.action_date;
        const filedOn = f.date;
        if (!madeUpTo || !filedOn) continue;
        const periodEnd = new Date(madeUpTo).getTime();
        const due = periodEnd + 270 * DAY; // ~9 months
        const filed = new Date(filedOn).getTime();
        if (filed > due) {
          const daysLate = (filed - due) / DAY;
          if (daysLate > 90) veryLateAccountsCount++;
          else lateAccountsCount++;
        }
      }
      if (lateAccountsCount > 0) {
        score -= Math.min(20, lateAccountsCount * 5);
        reasons.push(`${lateAccountsCount} accounts filed late`);
      }
      if (veryLateAccountsCount > 0) {
        score -= Math.min(40, veryLateAccountsCount * 10);
        reasons.push(`${veryLateAccountsCount} accounts filed very late (>90 days)`);
      }

      score = Math.max(0, Math.min(100, score));
      const band: FilingHealth['band'] =
        score >= 85 ? 'GOOD' : score >= 65 ? 'OK' : score >= 40 ? 'WEAK' : 'POOR';

      const filingHealth: FilingHealth = {
        score,
        band,
        lateAccountsCount,
        veryLateAccountsCount,
        totalAccountsFilings,
        confirmationOverdue,
        reasons,
      };
      meta.filingHealth = filingHealth;
      healthCount++;

      // ---- Account-type regression ----
      if (accountFilings.length >= 2) {
        const history = accountFilings
          .map((f) => ({
            date: (f.description_values?.made_up_date || f.date) as string,
            type: parseAccountsType(
              f.description_values?.accounts_type || f.description || '',
            ),
          }))
          .filter((h) => h.type !== 'unknown')
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        if (history.length >= 2) {
          const start = history[0];
          const end = history[history.length - 1];
          const monotonic = history.every(
            (h, i) => i === 0 || TYPE_RANK[h.type] <= TYPE_RANK[history[i - 1].type],
          );
          const regressed = monotonic && TYPE_RANK[end.type] < TYPE_RANK[start.type];
          const reg: AccountTypeRegression = {
            history,
            regressed,
            startType: start.type,
            endType: end.type,
          };
          meta.accountRegression = reg;
          if (regressed) regressedCount++;

          // ---- Dormant cycling ----
          let transitions = 0;
          let prevDormant: boolean | null = null;
          for (const h of history) {
            const isDorm = h.type === 'dormant';
            if (prevDormant !== null && isDorm !== prevDormant) transitions++;
            prevDormant = isDorm;
          }
          const oscillating = transitions >= 2;
          const dormantCycle: DormantCycle = { transitions, oscillating, history };
          meta.dormantCycle = dormantCycle;
          if (oscillating) cyclingCount++;
        }
      }

      c.metadata = meta;
      await this.nodes.update(c.id, { metadata: meta });
    }

    // ---- Phoenix pattern (cross-company, no API calls) ----
    const phoenixPairs = this.detectPhoenix(companies, edges, nodes);
    if (phoenixPairs.length > 0) {
      // Tag predecessor + successor with the relationship for downstream finding emission
      for (const p of phoenixPairs) {
        const pre = companies.find((c) => c.id === p.predecessorCompanyId);
        const suc = companies.find((c) => c.id === p.successorCompanyId);
        if (pre) {
          pre.metadata = { ...(pre.metadata || {}), phoenixSuccessor: p.successorLabel };
          await this.nodes.update(pre.id, { metadata: pre.metadata });
        }
        if (suc) {
          suc.metadata = { ...(suc.metadata || {}), phoenixPredecessor: p.predecessorLabel };
          await this.nodes.update(suc.id, { metadata: suc.metadata });
        }
      }
    }

    this.logger.log(
      `FilingHealth ${investigationId}: scored=${healthCount} regressed=${regressedCount} cycling=${cyclingCount} phoenix=${phoenixPairs.length}`,
    );

    return { healthCount, regressedCount, cyclingCount, phoenixPairs };
  }

  /**
   * Find phoenix pairs: company A dissolves and within 14 days company B
   * incorporates with at least one shared director and either a shared
   * address or a similar SIC code.
   */
  private detectPhoenix(
    companies: GraphNode[],
    edges: GraphEdge[],
    allNodes: GraphNode[],
  ): PhoenixPair[] {
    const dissolved = companies.filter((c) => c.metadata?.dissolutionDate);
    const incorporatedRecently = companies.filter((c) => c.metadata?.incorporationDate);
    if (dissolved.length === 0 || incorporatedRecently.length === 0) return [];

    // Index director edges by company → set of person node ids
    const directorsOf = new Map<string, Set<string>>();
    const addressOf = new Map<string, Set<string>>();
    for (const e of edges) {
      if (e.relationshipType === 'director' || e.relationshipType === 'appointment') {
        const cId = companies.find((c) => c.id === e.sourceNodeId)
          ? e.sourceNodeId
          : companies.find((c) => c.id === e.targetNodeId)
            ? e.targetNodeId
            : null;
        const pId = e.sourceNodeId === cId ? e.targetNodeId : e.sourceNodeId;
        if (!cId) continue;
        const set = directorsOf.get(cId) || new Set<string>();
        set.add(pId);
        directorsOf.set(cId, set);
      }
      if (e.relationshipType === 'address') {
        const cId = companies.find((c) => c.id === e.sourceNodeId)
          ? e.sourceNodeId
          : companies.find((c) => c.id === e.targetNodeId)
            ? e.targetNodeId
            : null;
        const aId = e.sourceNodeId === cId ? e.targetNodeId : e.sourceNodeId;
        if (!cId) continue;
        const set = addressOf.get(cId) || new Set<string>();
        set.add(aId);
        addressOf.set(cId, set);
      }
    }

    const pairs: PhoenixPair[] = [];
    for (const pre of dissolved) {
      const dDate = new Date(pre.metadata!.dissolutionDate).getTime();
      for (const suc of incorporatedRecently) {
        if (suc.id === pre.id) continue;
        const iDate = new Date(suc.metadata!.incorporationDate).getTime();
        if (isNaN(iDate) || isNaN(dDate)) continue;
        const days = (iDate - dDate) / DAY;
        if (days < -3 || days > 14) continue;

        const preDirs = directorsOf.get(pre.id) || new Set();
        const sucDirs = directorsOf.get(suc.id) || new Set();
        const sharedDirs: string[] = [];
        for (const d of preDirs) if (sucDirs.has(d)) sharedDirs.push(d);
        if (sharedDirs.length === 0) continue;

        const preAddrs = addressOf.get(pre.id) || new Set();
        const sucAddrs = addressOf.get(suc.id) || new Set();
        let sharedAddress = false;
        for (const a of preAddrs) if (sucAddrs.has(a)) { sharedAddress = true; break; }

        const preSic: string[] = pre.metadata?.sicCodes || [];
        const sucSic: string[] = suc.metadata?.sicCodes || [];
        const similarSic = preSic.some((s) => sucSic.includes(s));

        // Require shared address OR similar SIC to count as phoenix (not just shared director — that's normal)
        if (!sharedAddress && !similarSic) continue;

        pairs.push({
          predecessorCompanyId: pre.id,
          predecessorLabel: pre.label,
          successorCompanyId: suc.id,
          successorLabel: suc.label,
          daysBetween: Math.round(days),
          sharedDirectors: sharedDirs.map((id) => allNodes.find((n) => n.id === id)?.label || id),
          sharedAddress,
          similarSic,
        });
      }
    }
    return pairs;
  }
}
