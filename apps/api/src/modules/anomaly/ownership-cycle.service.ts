import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export interface OwnershipCycle {
  nodeIds: string[];
  labels: string[];
}

@Injectable()
export class OwnershipCycleService {
  private readonly logger = new Logger(OwnershipCycleService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  /**
   * Detect directed cycles in the ownership sub-graph (psc edges).
   * Edge psc: source = company, target = controlling person/company
   * For ownership cycles we walk in the "owns" direction:
   * if A controls B (psc edge B -> A reversed), we direct A -> B and look
   * for back edges via DFS.
   */
  async detect(investigationId: string): Promise<OwnershipCycle[]> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    // Directed adjacency: owner -> owned. PSC edges as stored: company -> controller.
    // So owner = target, owned = source.
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.relationshipType !== 'psc') continue;
      const owner = e.targetNodeId;
      const owned = e.sourceNodeId;
      const list = adj.get(owner) || [];
      list.push(owned);
      adj.set(owner, list);
    }

    const cycles: OwnershipCycle[] = [];
    const seen = new Set<string>();

    const dfs = (start: string, current: string, path: string[], visiting: Set<string>) => {
      visiting.add(current);
      path.push(current);
      for (const next of adj.get(current) || []) {
        if (next === start && path.length >= 2) {
          const key = [...path].sort().join('|');
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push({
              nodeIds: [...path],
              labels: path.map((id) => byId.get(id)?.label || id),
            });
          }
        } else if (!visiting.has(next)) {
          dfs(start, next, path, visiting);
        }
      }
      path.pop();
      visiting.delete(current);
    };

    for (const start of adj.keys()) {
      dfs(start, start, [], new Set());
    }

    this.logger.log(`Detected ${cycles.length} ownership cycle(s) in ${investigationId}`);
    return cycles;
  }
}
