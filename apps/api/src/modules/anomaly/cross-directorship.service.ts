import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export interface SameSicConflict {
  directorId: string;
  directorLabel: string;
  sicCode: string;
  companyIds: string[];
  companyLabels: string[];
}

export interface IncestuousNetwork {
  personIds: string[];
  personLabels: string[];
  companyIds: string[];
  companyLabels: string[];
  /** Average companies per person in this clique. */
  density: number;
}

export interface DualSidedDirector {
  directorId: string;
  directorLabel: string;
  /** Pairs of companies this director sits on that share a non-director edge
   *  (address, psc, or any relationship implying a business link). */
  linkedPairs: Array<{ companyA: string; companyB: string; labelA: string; labelB: string; linkType: string }>;
}

@Injectable()
export class CrossDirectorshipService {
  private readonly logger = new Logger(CrossDirectorshipService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async analyze(investigationId: string): Promise<{
    sameSicConflicts: SameSicConflict[];
    incestuousNetworks: IncestuousNetwork[];
    dualSidedDirectors: DualSidedDirector[];
  }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    const companies = nodes.filter((n) => n.entityType === 'company');
    const persons = nodes.filter((n) => n.entityType === 'person');
    const companyMap = new Map(companies.map((c) => [c.id, c]));
    const personMap = new Map(persons.map((p) => [p.id, p]));

    // Index: director edges  person <-> company
    const directorEdges = edges.filter(
      (e) => e.relationshipType === 'director' || e.relationshipType === 'appointment',
    );
    const companiesOfPerson = new Map<string, Set<string>>();
    const directorsOfCompany = new Map<string, Set<string>>();
    for (const e of directorEdges) {
      const cId = companyMap.has(e.sourceNodeId) ? e.sourceNodeId : companyMap.has(e.targetNodeId) ? e.targetNodeId : null;
      const pId = e.sourceNodeId === cId ? e.targetNodeId : e.sourceNodeId;
      if (!cId || !personMap.has(pId)) continue;
      if (!companiesOfPerson.has(pId)) companiesOfPerson.set(pId, new Set());
      companiesOfPerson.get(pId)!.add(cId);
      if (!directorsOfCompany.has(cId)) directorsOfCompany.set(cId, new Set());
      directorsOfCompany.get(cId)!.add(pId);
    }

    // ==== 1. SAME-SIC CONFLICT ====
    const sameSicConflicts: SameSicConflict[] = [];
    for (const [pId, cIds] of companiesOfPerson) {
      if (cIds.size < 2) continue;
      // Group by SIC
      const sicGroups = new Map<string, string[]>();
      for (const cId of cIds) {
        const sics: string[] = companyMap.get(cId)?.metadata?.sicCodes || [];
        for (const sic of sics) {
          if (!sicGroups.has(sic)) sicGroups.set(sic, []);
          sicGroups.get(sic)!.push(cId);
        }
      }
      for (const [sic, group] of sicGroups) {
        if (group.length < 2) continue;
        sameSicConflicts.push({
          directorId: pId,
          directorLabel: personMap.get(pId)?.label || pId,
          sicCode: sic,
          companyIds: group,
          companyLabels: group.map((id) => companyMap.get(id)?.label || id),
        });
      }
    }

    // ==== 2. INCESTUOUS NETWORKS ====
    // Find cliques of 3–5 people who cross-serve on ≥20 combined companies
    // Approach: for each pair of persons sharing ≥3 companies, try to grow a clique
    const incestuousNetworks: IncestuousNetwork[] = [];
    const personIds = [...companiesOfPerson.keys()].filter((p) => (companiesOfPerson.get(p)?.size || 0) >= 3);
    const visited = new Set<string>();

    for (let i = 0; i < personIds.length; i++) {
      for (let j = i + 1; j < personIds.length; j++) {
        const a = personIds[i];
        const b = personIds[j];
        const sharedAB = intersection(companiesOfPerson.get(a)!, companiesOfPerson.get(b)!);
        if (sharedAB.size < 3) continue;

        // Try to grow: find others who share ≥3 companies with both a and b
        const clique = [a, b];
        const cliqueCompanies = union(companiesOfPerson.get(a)!, companiesOfPerson.get(b)!);
        for (let k = j + 1; k < personIds.length && clique.length < 5; k++) {
          const c = personIds[k];
          const sharedWithClique = intersection(companiesOfPerson.get(c)!, cliqueCompanies);
          if (sharedWithClique.size >= 3) {
            clique.push(c);
            for (const x of companiesOfPerson.get(c)!) cliqueCompanies.add(x);
          }
        }

        if (clique.length < 3) continue;
        const key = clique.sort().join(',');
        if (visited.has(key)) continue;
        visited.add(key);

        const totalCompanies = cliqueCompanies.size;
        if (totalCompanies < 20) continue;

        incestuousNetworks.push({
          personIds: clique,
          personLabels: clique.map((id) => personMap.get(id)?.label || id),
          companyIds: [...cliqueCompanies],
          companyLabels: [...cliqueCompanies].map((id) => companyMap.get(id)?.label || id),
          density: Math.round((totalCompanies / clique.length) * 10) / 10,
        });
      }
    }

    // ==== 3. DUAL-SIDED DIRECTORS ====
    // Director sits on both sides of a non-director edge
    const nonDirectorEdges = edges.filter(
      (e) => e.relationshipType !== 'director' && e.relationshipType !== 'appointment',
    );
    // Build company-to-company links via non-director edges
    const companyLinks = new Map<string, Map<string, string>>();
    for (const e of nonDirectorEdges) {
      const sIsCompany = companyMap.has(e.sourceNodeId);
      const tIsCompany = companyMap.has(e.targetNodeId);
      if (!sIsCompany || !tIsCompany) continue;
      if (!companyLinks.has(e.sourceNodeId)) companyLinks.set(e.sourceNodeId, new Map());
      companyLinks.get(e.sourceNodeId)!.set(e.targetNodeId, e.relationshipType);
      if (!companyLinks.has(e.targetNodeId)) companyLinks.set(e.targetNodeId, new Map());
      companyLinks.get(e.targetNodeId)!.set(e.sourceNodeId, e.relationshipType);
    }

    const dualSidedDirectors: DualSidedDirector[] = [];
    for (const [pId, cIds] of companiesOfPerson) {
      if (cIds.size < 2) continue;
      const pairs: DualSidedDirector['linkedPairs'] = [];
      const arr = [...cIds];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const link = companyLinks.get(arr[i])?.get(arr[j]);
          if (link) {
            pairs.push({
              companyA: arr[i],
              companyB: arr[j],
              labelA: companyMap.get(arr[i])?.label || arr[i],
              labelB: companyMap.get(arr[j])?.label || arr[j],
              linkType: link,
            });
          }
        }
      }
      if (pairs.length > 0) {
        dualSidedDirectors.push({
          directorId: pId,
          directorLabel: personMap.get(pId)?.label || pId,
          linkedPairs: pairs,
        });
      }
    }

    this.logger.log(
      `CrossDirectorship ${investigationId}: sicConflicts=${sameSicConflicts.length} incestuous=${incestuousNetworks.length} dualSided=${dualSidedDirectors.length}`,
    );

    return { sameSicConflicts, incestuousNetworks, dualSidedDirectors };
  }
}

function intersection(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}
