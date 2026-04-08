import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { EntityMatch } from './entities/entity-match.entity';

export type ProximityScore = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CLEAR';

/**
 * For every node in an investigation, compute the shortest hop count to the
 * nearest sanctioned entity (matched via OpenSanctions sanctions topic).
 */
@Injectable()
export class SanctionsProximityService {
  private readonly logger = new Logger(SanctionsProximityService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(EntityMatch) private readonly matches: Repository<EntityMatch>,
  ) {}

  async compute(investigationId: string): Promise<{ scored: number; flagged: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const matches = await this.matches.find({ where: { investigationId } });

    // Sanctioned source-entity ids = entityIds of graph nodes that have any match
    // with sanctions topic OR any opensanctions match (treat all as sanctions for hops).
    const sanctionedNodeIds = new Set<string>();
    const matchByNode = new Map<string, EntityMatch[]>();
    for (const m of matches) {
      const list = matchByNode.get(m.sourceEntityId) || [];
      list.push(m);
      matchByNode.set(m.sourceEntityId, list);
    }

    // Map graph_nodes by their primary id
    const idToNode = new Map<string, GraphNode>();
    for (const n of nodes) idToNode.set(n.id, n);

    // A node is "sanctioned" if any match against opensanctions hit it.
    for (const n of nodes) {
      const ms = matchByNode.get(n.entityId) || [];
      if (ms.some((m) => m.matchedSource === 'opensanctions')) {
        sanctionedNodeIds.add(n.id);
      }
    }

    // Build adjacency
    const adj = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!adj.has(e.sourceNodeId)) adj.set(e.sourceNodeId, new Set());
      if (!adj.has(e.targetNodeId)) adj.set(e.targetNodeId, new Set());
      adj.get(e.sourceNodeId)!.add(e.targetNodeId);
      adj.get(e.targetNodeId)!.add(e.sourceNodeId);
    }

    // Multi-source BFS from all sanctioned nodes
    const dist = new Map<string, number>();
    const queue: string[] = [];
    for (const sid of sanctionedNodeIds) {
      dist.set(sid, 0);
      queue.push(sid);
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = dist.get(cur)!;
      for (const nb of adj.get(cur) || []) {
        if (!dist.has(nb)) {
          dist.set(nb, d + 1);
          queue.push(nb);
        }
      }
    }

    let flagged = 0;
    for (const n of nodes) {
      const d = dist.get(n.id);
      const score = this.classify(d);
      n.proximityScore = score;
      n.proximityHops = d ?? null as any;
      if (score !== 'CLEAR') flagged++;
      await this.nodes.save(n);
    }

    this.logger.log(`Computed proximity for ${nodes.length} nodes in ${investigationId} (${flagged} flagged)`);
    return { scored: nodes.length, flagged };
  }

  classify(hops?: number): ProximityScore {
    if (hops === undefined) return 'CLEAR';
    if (hops === 0) return 'CRITICAL';
    if (hops === 1) return 'HIGH';
    if (hops === 2) return 'MEDIUM';
    return 'LOW';
  }
}
