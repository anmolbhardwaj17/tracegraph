import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;
const NEW_COMPANY_CHARGES_CAP = 25;

export interface ShelfPurchase {
  companyId: string;
  companyLabel: string;
  ageYears: number;
  recentDirectorChanges: number;
  evidence: string[];
}

export interface BrandNewWithCharges {
  companyId: string;
  companyLabel: string;
  ageDays: number;
  chargeCount: number;
  totalCharges: number;
}

export interface MassFormationEvent {
  directorId: string;
  directorLabel: string;
  date: string;
  companyIds: string[];
  companyLabels: string[];
}

export interface FilingGapRevival {
  companyId: string;
  companyLabel: string;
  gapYears: number;
  resumedAt: string;
  beforeType?: string;
  afterType?: string;
}

@Injectable()
export class CompanyAgeAnomalyService {
  private readonly logger = new Logger(CompanyAgeAnomalyService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    private readonly ch: CompaniesHouseService,
  ) {}

  async detect(investigationId: string): Promise<{
    shelfPurchases: ShelfPurchase[];
    brandNewWithCharges: BrandNewWithCharges[];
    massFormationEvents: MassFormationEvent[];
    filingGapRevivals: FilingGapRevival[];
  }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const companies = nodes.filter((n) => n.entityType === 'company');
    const persons = nodes.filter((n) => n.entityType === 'person');

    const now = Date.now();

    // ==== 1. SHELF PURCHASE ====
    // Old company (10+ years), long dormant period followed by recent director churn.
    const shelfPurchases: ShelfPurchase[] = [];
    for (const c of companies) {
      const inc = c.metadata?.incorporationDate;
      if (!inc) continue;
      const ageYears = (now - new Date(inc).getTime()) / YEAR;
      if (ageYears < 10) continue;

      // Recent director changes: appointed_on within last 18 months on edges touching this company
      const directorEdges = edges.filter(
        (e) =>
          (e.relationshipType === 'director' || e.relationshipType === 'appointment') &&
          (e.sourceNodeId === c.id || e.targetNodeId === c.id),
      );
      const recentChanges = directorEdges.filter((e) => {
        const a = e.metadata?.appointedOn;
        if (!a) return false;
        return now - new Date(a).getTime() < 18 * 30 * DAY;
      }).length;

      // Was the company quiet before this? Use accountRegression history (Section 2)
      // — if there are no filings older than 5 years, OR most filings are dormant,
      // treat the recent activity as suspicious.
      const reg = c.metadata?.accountRegression?.history || [];
      const wasDormant =
        reg.length === 0 ||
        reg.every((h: any) => h.type === 'dormant' || h.type === 'unknown');

      if (recentChanges >= 2 && wasDormant) {
        shelfPurchases.push({
          companyId: c.id,
          companyLabel: c.label,
          ageYears: Math.round(ageYears),
          recentDirectorChanges: recentChanges,
          evidence: [
            `Age: ${Math.round(ageYears)} years`,
            `Director changes (last 18mo): ${recentChanges}`,
            wasDormant ? 'Previously dormant or no filings' : '',
          ].filter(Boolean),
        });
      }
    }

    // ==== 2. BRAND-NEW WITH LARGE CHARGES ====
    // For companies < 1 year old (capped at NEW_COMPANY_CHARGES_CAP), pull charges
    // and flag any with ≥1 charge registered.
    const brandNew = companies.filter((c) => {
      const inc = c.metadata?.incorporationDate;
      if (!inc) return false;
      const days = (now - new Date(inc).getTime()) / DAY;
      return days >= 0 && days < 365;
    });
    const brandNewWithCharges: BrandNewWithCharges[] = [];
    for (const c of brandNew.slice(0, NEW_COMPANY_CHARGES_CAP)) {
      try {
        const charges = await this.ch.getCharges(c.entityId);
        const total = charges?.total_count || charges?.items?.length || 0;
        if (total >= 1) {
          const inc = new Date(c.metadata!.incorporationDate).getTime();
          brandNewWithCharges.push({
            companyId: c.id,
            companyLabel: c.label,
            ageDays: Math.round((now - inc) / DAY),
            chargeCount: total,
            totalCharges: total,
          });
          // Persist on metadata so the frontend can surface it
          c.metadata = { ...(c.metadata || {}), chargesCount: total };
          await this.nodes.update(c.id, { metadata: c.metadata as any });
        }
      } catch { /* 404 / no charges → skip */ }
    }

    // ==== 3. MASS FORMATION BY SAME DIRECTOR ====
    // Group companies by (director, incorporationDate-day-bucket); flag groups ≥5
    const formationByDirector = new Map<string, Map<string, string[]>>();
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const cId = companies.find((c) => c.id === e.sourceNodeId)
        ? e.sourceNodeId
        : companies.find((c) => c.id === e.targetNodeId)
          ? e.targetNodeId
          : null;
      const pId = e.sourceNodeId === cId ? e.targetNodeId : e.sourceNodeId;
      if (!cId) continue;
      const company = companies.find((c) => c.id === cId);
      const inc = company?.metadata?.incorporationDate;
      if (!inc) continue;
      const dayKey = inc.toString().slice(0, 10);
      if (!formationByDirector.has(pId)) formationByDirector.set(pId, new Map());
      const inner = formationByDirector.get(pId)!;
      if (!inner.has(dayKey)) inner.set(dayKey, []);
      const list = inner.get(dayKey)!;
      if (!list.includes(cId)) list.push(cId);
    }
    const massFormationEvents: MassFormationEvent[] = [];
    for (const [personId, dayMap] of formationByDirector.entries()) {
      for (const [date, companyIds] of dayMap.entries()) {
        if (companyIds.length < 5) continue;
        const personLabel = persons.find((p) => p.id === personId)?.label || 'Unknown director';
        const labels = companyIds.map((cid) => companies.find((c) => c.id === cid)?.label || cid);
        massFormationEvents.push({
          directorId: personId,
          directorLabel: personLabel,
          date,
          companyIds,
          companyLabels: labels,
        });
      }
    }

    // ==== 4. MULTI-YEAR FILING GAP REACTIVATION ====
    // Use accountRegression.history (set by Section 2) — find a gap >2 years
    // between consecutive filings, where activity resumed after the gap.
    const filingGapRevivals: FilingGapRevival[] = [];
    for (const c of companies) {
      const history: any[] = c.metadata?.accountRegression?.history || [];
      if (history.length < 2) continue;
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const curr = history[i];
        const gap = (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / YEAR;
        if (gap < 2) continue;
        filingGapRevivals.push({
          companyId: c.id,
          companyLabel: c.label,
          gapYears: Math.round(gap * 10) / 10,
          resumedAt: curr.date,
          beforeType: prev.type,
          afterType: curr.type,
        });
        break; // one finding per company is enough
      }
    }

    this.logger.log(
      `CompanyAgeAnomaly ${investigationId}: shelf=${shelfPurchases.length} brandNewCharges=${brandNewWithCharges.length} massFormation=${massFormationEvents.length} gapRevivals=${filingGapRevivals.length}`,
    );

    return { shelfPurchases, brandNewWithCharges, massFormationEvents, filingGapRevivals };
  }
}
