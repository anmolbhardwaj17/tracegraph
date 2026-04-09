import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export type ShellRisk = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ShellScoreBreakdown {
  score: number;
  risk: ShellRisk;
  reasons: string[];
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  /**
   * Score shell-company likelihood for each company node.
   * Persists shellCompanyScore on node.metadata.
   */
  async scoreShellCompanies(investigationId: string): Promise<{ scored: number; high: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    const byId = new Map<string, GraphNode>();
    for (const n of nodes) byId.set(n.id, n);

    // Build helper maps
    // person -> company edges (director or appointment)
    const personDirectorships = new Map<string, GraphNode[]>();
    // company -> address node
    const companyAddress = new Map<string, GraphNode>();
    // address -> companies count
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

    for (const company of companyNodes) {
      const breakdown = this.computeShellScore(company, edges, byId, personDirectorships, addressCompanies, companyAddress);
      company.metadata = { ...(company.metadata || {}), shellCompanyScore: breakdown };
      if (breakdown.risk === 'HIGH') high++;
      await this.nodes.save(company);
    }

    this.logger.log(`Scored ${companyNodes.length} companies (${high} HIGH risk)`);
    return { scored: companyNodes.length, high };
  }

  private computeShellScore(
    company: GraphNode,
    edges: GraphEdge[],
    byId: Map<string, GraphNode>,
    personDirectorships: Map<string, GraphNode[]>,
    addressCompanies: Map<string, GraphNode[]>,
    companyAddress: Map<string, GraphNode>,
  ): ShellScoreBreakdown {
    const reasons: string[] = [];
    let score = 0;

    // Find directors of this company
    const directorEdges = edges.filter(
      (e) =>
        (e.relationshipType === 'director' || e.relationshipType === 'appointment') &&
        (e.sourceNodeId === company.id || e.targetNodeId === company.id),
    );

    for (const e of directorEdges) {
      const personId = e.sourceNodeId === company.id ? e.targetNodeId : e.sourceNodeId;
      const person = byId.get(personId);
      if (!person || person.entityType !== 'person') continue;
      const companies = personDirectorships.get(person.id) || [];
      const active = companies.filter((c) => c.metadata?.status === 'active');
      const dissolved = companies.filter((c) => /dissolved/i.test(c.metadata?.status || ''));
      if (active.length >= 10) {
        score += 20;
        reasons.push(`Director "${person.label}" has ${active.length} active companies`);
      }
      if (dissolved.length >= 5) {
        score += 15;
        reasons.push(`Director "${person.label}" has ${dissolved.length} dissolved companies`);
      }
    }

    // Address clustering
    const address = companyAddress.get(company.id);
    if (address) {
      const cohort = addressCompanies.get(address.id) || [];
      const count = cohort.length;
      if (count >= 20) {
        score += 15;
        reasons.push(`Registered at virtual office address shared by ${count} companies`);
      } else if (count >= 5) {
        score += 8;
        reasons.push(`Address shared by ${count} other companies`);
      }
    }

    // Dissolved within 2 years of incorporation
    const inc = company.metadata?.incorporationDate;
    const diss = company.metadata?.dissolutionDate;
    if (inc && diss) {
      const ms = new Date(diss).getTime() - new Date(inc).getTime();
      const years = ms / (1000 * 60 * 60 * 24 * 365);
      if (years > 0 && years < 2) {
        score += 10;
        reasons.push(`Dissolved ${years.toFixed(1)} years after incorporation`);
      }
    }

    // Dormant / micro-entity accounts
    const accountsType = company.metadata?.accountsType || company.metadata?.lastAccounts?.type;
    if (accountsType && /(dormant|micro-entity)/i.test(accountsType)) {
      score += 10;
      reasons.push(`Files ${accountsType} accounts`);
    }

    // Filing activity heuristic
    if (company.metadata?.onlyConfirmationStatements === true) {
      score += 5;
      reasons.push('No significant filings beyond confirmation statements');
    }

    const risk: ShellRisk = score > 50 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
    return { score, risk, reasons };
  }
}
