import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export interface Community {
  id: number;
  nodeIds: string[];
  size: number;
  internalEdges: number;
  externalEdges: number;
  internalDensity: number;
}

export interface BridgeNode {
  nodeId: string;
  label: string;
  betweenness: number;
  bridgesCommunities: number[];
}

@Injectable()
export class CommunityDetectionService {
  private readonly logger = new Logger(CommunityDetectionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  /**
   * Simplified Louvain — single pass label propagation. Each node initially
   * has its own community; iteratively each node adopts the most common
   * community label among its neighbors. Converges in O(n*iters).
   */
  async detect(investigationId: string): Promise<{ communities: Community[]; bridges: BridgeNode[] }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    if (nodes.length === 0) return { communities: [], bridges: [] };

    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const e of edges) {
      adj.get(e.sourceNodeId)?.add(e.targetNodeId);
      adj.get(e.targetNodeId)?.add(e.sourceNodeId);
    }

    // Label propagation
    const label = new Map<string, number>();
    nodes.forEach((n, i) => label.set(n.id, i));

    const maxIters = 10;
    for (let it = 0; it < maxIters; it++) {
      let changed = false;
      // Random shuffle order
      const order = [...nodes].sort(() => Math.random() - 0.5);
      for (const n of order) {
        const counts = new Map<number, number>();
        for (const nb of adj.get(n.id) || []) {
          const l = label.get(nb)!;
          counts.set(l, (counts.get(l) || 0) + 1);
        }
        if (counts.size === 0) continue;
        const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        if (best !== label.get(n.id)) {
          label.set(n.id, best);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Compact community ids and assemble
    const groups = new Map<number, string[]>();
    for (const [nodeId, l] of label.entries()) {
      const arr = groups.get(l) || [];
      arr.push(nodeId);
      groups.set(l, arr);
    }

    const communities: Community[] = [];
    let cid = 0;
    const idToCommunity = new Map<string, number>();
    for (const [, members] of groups.entries()) {
      const community: Community = {
        id: cid,
        nodeIds: members,
        size: members.length,
        internalEdges: 0,
        externalEdges: 0,
        internalDensity: 0,
      };
      for (const m of members) idToCommunity.set(m, cid);
      communities.push(community);
      cid++;
    }

    for (const e of edges) {
      const a = idToCommunity.get(e.sourceNodeId);
      const b = idToCommunity.get(e.targetNodeId);
      if (a === undefined || b === undefined) continue;
      if (a === b) communities[a].internalEdges++;
      else {
        communities[a].externalEdges++;
        communities[b].externalEdges++;
      }
    }
    for (const c of communities) {
      const possible = (c.size * (c.size - 1)) / 2;
      c.internalDensity = possible > 0 ? c.internalEdges / possible : 0;
    }

    // Bridge detection: persons whose removal would split companies into
    // disconnected communities. Approximate via "connects ≥2 distinct communities".
    const bridges: BridgeNode[] = [];
    for (const n of nodes) {
      if (n.entityType !== 'person') continue;
      const neighborCommunities = new Set<number>();
      for (const nb of adj.get(n.id) || []) {
        const c = idToCommunity.get(nb);
        if (c !== undefined) neighborCommunities.add(c);
      }
      if (neighborCommunities.size >= 2) {
        // crude betweenness proxy = neighbor count * communities-touched
        const betweenness = (adj.get(n.id)?.size || 0) * neighborCommunities.size;
        bridges.push({
          nodeId: n.id,
          label: n.label,
          betweenness,
          bridgesCommunities: [...neighborCommunities],
        });
      }
    }
    bridges.sort((a, b) => b.betweenness - a.betweenness);

    this.logger.log(
      `Found ${communities.length} communities and ${bridges.length} bridge node(s) in ${investigationId}`,
    );
    return { communities, bridges };
  }
}
