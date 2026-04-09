import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { CompanyProfile } from './company-classifier.service';

export type ShellRisk = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface ShellScoreBreakdown {
  score: number;
  risk: ShellRisk;
  reasons: string[];
}

const NOW = () => new Date();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const FORMATION_AGENT_PATTERNS = /(virtual|registered office|mail forwarding|formation|company services|business centre|business center|c\/o)/i;

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async scoreShellCompanies(investigationId: string): Promise<{ scored: number; high: number; critical: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const byId = new Map<string, GraphNode>();
    for (const n of nodes) byId.set(n.id, n);

    // Build helper maps
    const personDirectorships = new Map<string, GraphNode[]>();
    const companyAddress = new Map<string, GraphNode>();
    const addressCompanies = new Map<string, GraphNode[]>();

    for (const e of edges) {
      const src = byId.get(e.sourceNodeId);
      const tgt = byId.get(e.targetNodeId);
      if (!src || !tgt) continue;

      if (e.relationshipType === 'director' || e.relationshipType === 'appointment') {
        const person = src.entityType === 'person' ? src : tgt.entityType === 'person' ? tgt : null;
        const company = src.entityType === 'company' ? src : tgt.entityType === 'company' ? tgt : null;
        if (person && company) {
          const list = personDirectorships.get(person.id) || [];
          list.push(company);
          personDirectorships.set(person.id, list);
        }
      }
      if (e.relationshipType === 'address') {
        const company = src.entityType === 'company' ? src : tgt.entityType === 'company' ? tgt : null;
        const address = src.entityType === 'address' ? src : tgt.entityType === 'address' ? tgt : null;
        if (company && address) {
          companyAddress.set(company.id, address);
          const list = addressCompanies.get(address.id) || [];
          list.push(company);
          addressCompanies.set(address.id, list);
        }
      }
    }

    const companyNodes = nodes.filter((n) => n.entityType === 'company');
    let high = 0;
    let critical = 0;

    for (const company of companyNodes) {
      const profile: CompanyProfile = company.metadata?.companyProfile || 'SMALL_PRIVATE';
      const breakdown = this.computeShellScore(
        company,
        profile,
        edges,
        byId,
        personDirectorships,
        addressCompanies,
        companyAddress,
      );
      company.metadata = { ...(company.metadata || {}), shellCompanyScore: breakdown };
      if (breakdown.risk === 'HIGH') high++;
      if (breakdown.risk === 'CRITICAL') critical++;
      await this.nodes.save(company);
    }

    this.logger.log(`Scored ${companyNodes.length} companies (${critical} CRITICAL, ${high} HIGH)`);
    return { scored: companyNodes.length, high, critical };
  }

  private computeShellScore(
    company: GraphNode,
    profile: CompanyProfile,
    edges: GraphEdge[],
    byId: Map<string, GraphNode>,
    personDirectorships: Map<string, GraphNode[]>,
    addressCompanies: Map<string, GraphNode[]>,
    companyAddress: Map<string, GraphNode>,
  ): ShellScoreBreakdown {
    // Hard gate: legitimate large/established companies are almost never shells
    if (profile === 'LARGE_PUBLIC' || profile === 'ESTABLISHED_PRIVATE') {
      // Only flag on direct sanctions match or circular ownership (handled elsewhere)
      return { score: 0, risk: 'LOW', reasons: [] };
    }

    if (profile === 'FOREIGN') {
      return { score: 5, risk: 'LOW', reasons: ['Foreign-registered entity — review jurisdiction risk'] };
    }

    const reasons: string[] = [];
    let score = 0;
    const meta = company.metadata || {};

    // ---- DIRECTOR PORTFOLIO SIGNALS ----
    const directorEdges = edges.filter(
      (e) =>
        (e.relationshipType === 'director' || e.relationshipType === 'appointment') &&
        (e.sourceNodeId === company.id || e.targetNodeId === company.id),
    );

    for (const e of directorEdges) {
      const personId = e.sourceNodeId === company.id ? e.targetNodeId : e.sourceNodeId;
      const person = byId.get(personId);
      if (!person || person.entityType !== 'person') continue;

      const portfolio = personDirectorships.get(person.id) || [];
      const active = portfolio.filter((c) => /active/i.test(c.metadata?.status || ''));
      const dissolved = portfolio.filter((c) => /dissolved|liquidat|struck/i.test(c.metadata?.status || ''));
      const recentlyDissolved = dissolved.filter((c) => {
        const d = c.metadata?.dissolutionDate;
        if (!d) return false;
        const ageYears = (NOW().getTime() - new Date(d).getTime()) / YEAR_MS;
        return ageYears < 3;
      });
      const microOnly = portfolio.length > 0 && portfolio.every((c) =>
        /(micro|dormant)/i.test(c.metadata?.accountsType || ''),
      );

      if (active.length >= 20) {
        score += 25;
        reasons.push(`Director "${person.label}" has ${active.length} active companies`);
      } else if (active.length >= 10) {
        score += 15;
        reasons.push(`Director "${person.label}" has ${active.length} active companies`);
      }

      if (dissolved.length >= 10) {
        score += 25;
        reasons.push(`Director "${person.label}" has ${dissolved.length} dissolved companies`);
      } else if (recentlyDissolved.length >= 5) {
        score += 20;
        reasons.push(`Director "${person.label}" has ${recentlyDissolved.length} dissolved companies in the last 3 years`);
      }

      if (microOnly && portfolio.length >= 3) {
        score += 15;
        reasons.push(`Director "${person.label}" only sits on micro/dormant entities`);
      }
    }

    // ---- ADDRESS SIGNALS ----
    const address = companyAddress.get(company.id);
    if (address) {
      const cohort = addressCompanies.get(address.id) || [];
      const count = cohort.length;
      if (count >= 30) {
        score += 20;
        reasons.push(`Address shared with ${count} companies — likely formation agent`);
      } else if (count >= 15) {
        score += 12;
        reasons.push(`Address shared with ${count} companies — possible virtual office`);
      } else if (count >= 5) {
        score += 5;
        reasons.push(`Address shared with ${count} other companies`);
      }
      if (FORMATION_AGENT_PATTERNS.test(address.label || '')) {
        score += 15;
        reasons.push('Address matches formation-agent / virtual-office naming pattern');
      }
    }

    // ---- FILING SIGNALS ----
    const accountsType = (meta.accountsType || '').toLowerCase();
    const directorPortfolioMax = Math.max(
      0,
      ...directorEdges.map((e) => {
        const personId = e.sourceNodeId === company.id ? e.targetNodeId : e.sourceNodeId;
        return (personDirectorships.get(personId) || []).length;
      }),
    );

    if (/dormant/.test(accountsType)) {
      score += 10;
      reasons.push('Files dormant accounts');
    }
    if (/micro/.test(accountsType) && directorPortfolioMax >= 10) {
      score += 12;
      reasons.push(`Files micro-entity accounts AND a director sits on ${directorPortfolioMax} other companies`);
    }
    if (meta.confirmationStatementOverdue) {
      score += 5;
      reasons.push('Confirmation statement overdue');
    }
    if (meta.hasInsolvencyHistory) {
      score += 8;
      reasons.push('Has prior insolvency history');
    }

    // ---- LIFECYCLE SIGNALS ----
    const inc = meta.incorporationDate;
    const diss = meta.dissolutionDate;
    if (inc && diss) {
      const months = (new Date(diss).getTime() - new Date(inc).getTime()) / (DAY_MS * 30);
      if (months > 0 && months < 12) {
        score += 20;
        reasons.push(`Dissolved within ${Math.round(months)} months of incorporation`);
      } else if (months > 0 && months < 18) {
        score += 15;
        reasons.push(`Dissolved within ${Math.round(months)} months of incorporation`);
      }
    }

    // ---- SIC SIGNALS ----
    const sicCodes: string[] = meta.sicCodes || [];
    const suspiciousSics = sicCodes.filter((c) => c === '74990' || c === '64209');
    if (suspiciousSics.length > 0 && /(micro|dormant)/.test(accountsType)) {
      score += 8;
      reasons.push(`Holding/non-trading SIC ${suspiciousSics.join(', ')} combined with micro accounts`);
    }
    if (sicCodes.length === 0) {
      score += 5;
      reasons.push('No SIC code declared');
    }

    // ---- NEWLY FORMED extra signals ----
    if (profile === 'NEWLY_FORMED') {
      // Look for sibling companies incorporated by the same director within 30 days
      let coIncCount = 0;
      for (const e of directorEdges) {
        const personId = e.sourceNodeId === company.id ? e.targetNodeId : e.sourceNodeId;
        const portfolio = personDirectorships.get(personId) || [];
        if (!inc) continue;
        const myInc = new Date(inc).getTime();
        for (const sibling of portfolio) {
          if (sibling.id === company.id) continue;
          const sInc = sibling.metadata?.incorporationDate;
          if (!sInc) continue;
          const diff = Math.abs(myInc - new Date(sInc).getTime());
          if (diff <= 30 * DAY_MS) coIncCount++;
        }
      }
      if (coIncCount >= 3) {
        score += 20;
        reasons.push(`${coIncCount} sibling companies incorporated by the same director within 30 days`);
      }
    }

    // ---- THRESHOLDS BY PROFILE ----
    const thresholds = {
      LARGE_PUBLIC:        { critical: 9999, high: 9999, medium: 9999 },
      ESTABLISHED_PRIVATE: { critical: 9999, high: 9999, medium: 9999 },
      SMALL_PRIVATE:       { critical: 70,   high: 45,   medium: 25 },
      MICRO_ENTITY:        { critical: 70,   high: 45,   medium: 25 },
      NEWLY_FORMED:        { critical: 60,   high: 35,   medium: 20 },
      DISSOLVED:           { critical: 70,   high: 45,   medium: 25 },
      FOREIGN:             { critical: 70,   high: 45,   medium: 25 },
    } as const;
    const t = thresholds[profile];
    let risk: ShellRisk;
    if (score >= t.critical) risk = 'CRITICAL';
    else if (score >= t.high) risk = 'HIGH';
    else if (score >= t.medium) risk = 'MEDIUM';
    else risk = 'LOW';

    return { score, risk, reasons };
  }
}
