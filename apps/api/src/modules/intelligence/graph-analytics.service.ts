import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Finding } from '../risk-scoring/finding.types';

export interface AnalyticsResult {
  centrality: Array<{ nodeId: string; label: string; betweenness: number; degree: number }>;
  communities: Array<{ id: number; nodes: string[]; size: number }>;
  cycles: Array<{ path: string[]; labels: string[] }>;
  keyPersons: Array<{ nodeId: string; label: string; reason: string }>;
  findings: Finding[];
}

/**
 * Phase II: Graph Analytics Engine.
 *
 * Runs graph algorithms on the investigation network to discover
 * non-obvious patterns:
 * - Centrality: who is the most important/connected person?
 * - Community detection: which groups are tightly connected?
 * - Cycle detection: circular ownership / director loops
 * - Key person identification: remove this node and network fractures
 */
@Injectable()
export class GraphAnalyticsService {
  private readonly logger = new Logger(GraphAnalyticsService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async analyze(investigationId: string): Promise<AnalyticsResult> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    this.logger.log(`Graph analytics: ${nodes.length} nodes, ${edges.length} edges`);

    // Build adjacency list
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const e of edges) {
      adj.get(e.sourceNodeId)?.add(e.targetNodeId);
      adj.get(e.targetNodeId)?.add(e.sourceNodeId);
    }

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    // 1. Degree + Betweenness centrality
    const centrality = this.computeCentrality(nodes, adj);

    // 2. Community detection (simple label propagation)
    const communities = this.detectCommunities(nodes, adj);

    // 3. Cycle detection (directed)
    const dirAdj = new Map<string, Set<string>>();
    for (const n of nodes) dirAdj.set(n.id, new Set());
    for (const e of edges) {
      if (e.relationshipType === 'psc' || e.relationshipType === 'director') {
        dirAdj.get(e.sourceNodeId)?.add(e.targetNodeId);
      }
    }
    const cycles = this.detectCycles(dirAdj, nodeMap);

    // 4. Key person detection
    const keyPersons = this.findKeyPersons(nodes, adj, centrality);

    // 5. Update node metadata with analytics
    for (const c of centrality) {
      const meta = (nodeMap.get(c.nodeId)?.metadata || {}) as any;
      meta.analytics = { betweenness: c.betweenness, degree: c.degree };
      await this.nodes.update(c.nodeId, { metadata: meta }).catch(() => {});
    }

    // Generate findings
    const findings = this.generateFindings(centrality, communities, cycles, keyPersons, nodeMap);

    this.logger.log(
      `Graph analytics complete: ${centrality.length} centrality scores, ${communities.length} communities, ${cycles.length} cycles, ${keyPersons.length} key persons`,
    );

    return { centrality, communities, cycles, keyPersons, findings };
  }

  /** Compute degree and approximate betweenness centrality */
  private computeCentrality(
    nodes: GraphNode[],
    adj: Map<string, Set<string>>,
  ): AnalyticsResult['centrality'] {
    const result: AnalyticsResult['centrality'] = [];
    const n = nodes.length;

    // Betweenness: for each node, count how many shortest paths pass through it
    // Approximate: sample random pairs instead of all pairs for large graphs
    const betweenness = new Map<string, number>();
    for (const node of nodes) betweenness.set(node.id, 0);

    const sampleSize = Math.min(n * 2, 200);
    for (let s = 0; s < sampleSize; s++) {
      const source = nodes[Math.floor(Math.random() * n)];
      // BFS from source
      const dist = new Map<string, number>();
      const paths = new Map<string, number>();
      const pred = new Map<string, string[]>();
      const queue: string[] = [source.id];
      dist.set(source.id, 0);
      paths.set(source.id, 1);

      while (queue.length > 0) {
        const v = queue.shift()!;
        for (const w of adj.get(v) || []) {
          if (!dist.has(w)) {
            dist.set(w, (dist.get(v) || 0) + 1);
            paths.set(w, 0);
            queue.push(w);
            pred.set(w, []);
          }
          if (dist.get(w) === (dist.get(v) || 0) + 1) {
            paths.set(w, (paths.get(w) || 0) + (paths.get(v) || 0));
            pred.get(w)?.push(v);
          }
        }
      }

      // Accumulate betweenness
      const delta = new Map<string, number>();
      const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
      for (const [w] of sorted) {
        delta.set(w, 0);
        for (const v of pred.get(w) || []) {
          const d = ((paths.get(v) || 1) / (paths.get(w) || 1)) * (1 + (delta.get(w) || 0));
          delta.set(v, (delta.get(v) || 0) + d);
        }
        if (w !== source.id) {
          betweenness.set(w, (betweenness.get(w) || 0) + (delta.get(w) || 0));
        }
      }
    }

    // Normalize
    const maxBet = Math.max(...betweenness.values(), 1);
    for (const node of nodes) {
      const degree = adj.get(node.id)?.size || 0;
      const bet = Math.round(((betweenness.get(node.id) || 0) / maxBet) * 100);
      result.push({ nodeId: node.id, label: node.label, betweenness: bet, degree });
    }

    return result.sort((a, b) => b.betweenness - a.betweenness);
  }

  /** Simple label propagation community detection */
  private detectCommunities(
    nodes: GraphNode[],
    adj: Map<string, Set<string>>,
  ): AnalyticsResult['communities'] {
    // Initialize each node with its own label
    const label = new Map<string, number>();
    nodes.forEach((n, i) => label.set(n.id, i));

    // Iterate: each node adopts the most common label among its neighbors
    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (const node of nodes) {
        const neighbors = adj.get(node.id);
        if (!neighbors || neighbors.size === 0) continue;

        const counts = new Map<number, number>();
        for (const nb of neighbors) {
          const l = label.get(nb) || 0;
          counts.set(l, (counts.get(l) || 0) + 1);
        }

        const maxLabel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (maxLabel != null && maxLabel !== label.get(node.id)) {
          label.set(node.id, maxLabel);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // Group nodes by label
    const groups = new Map<number, string[]>();
    for (const [nodeId, l] of label) {
      if (!groups.has(l)) groups.set(l, []);
      groups.get(l)!.push(nodeId);
    }

    return [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([id, members], i) => ({ id: i, nodes: members, size: members.length }))
      .sort((a, b) => b.size - a.size);
  }

  /** Detect cycles using DFS (directed graph) */
  private detectCycles(
    dirAdj: Map<string, Set<string>>,
    nodeMap: Map<string, GraphNode>,
  ): AnalyticsResult['cycles'] {
    const cycles: AnalyticsResult['cycles'] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const parent = new Map<string, string>();

    const dfs = (nodeId: string, path: string[]): void => {
      if (cycles.length >= 5) return; // cap at 5 cycles
      visited.add(nodeId);
      stack.add(nodeId);
      path.push(nodeId);

      for (const neighbor of dirAdj.get(nodeId) || []) {
        if (stack.has(neighbor)) {
          // Found a cycle
          const cycleStart = path.indexOf(neighbor);
          if (cycleStart >= 0) {
            const cyclePath = path.slice(cycleStart);
            cyclePath.push(neighbor); // close the cycle
            cycles.push({
              path: cyclePath,
              labels: cyclePath.map((id) => nodeMap.get(id)?.label || id),
            });
          }
        } else if (!visited.has(neighbor)) {
          dfs(neighbor, [...path]);
        }
      }

      stack.delete(nodeId);
    };

    for (const nodeId of dirAdj.keys()) {
      if (!visited.has(nodeId) && cycles.length < 5) {
        dfs(nodeId, []);
      }
    }

    return cycles;
  }

  /** Find key persons — removal would fragment the network */
  private findKeyPersons(
    nodes: GraphNode[],
    adj: Map<string, Set<string>>,
    centrality: AnalyticsResult['centrality'],
  ): AnalyticsResult['keyPersons'] {
    const keyPersons: AnalyticsResult['keyPersons'] = [];

    // High betweenness + person = key person
    for (const c of centrality.slice(0, 10)) {
      const node = nodes.find((n) => n.id === c.nodeId);
      if (!node) continue;

      if (node.entityType === 'person' && c.betweenness > 50) {
        keyPersons.push({
          nodeId: c.nodeId,
          label: c.label,
          reason: `Betweenness centrality ${c.betweenness}% — bridges ${c.degree} connections`,
        });
      }

      // High-degree company nodes
      if (node.entityType === 'company' && c.degree > 10) {
        keyPersons.push({
          nodeId: c.nodeId,
          label: c.label,
          reason: `Hub company with ${c.degree} direct connections`,
        });
      }
    }

    return keyPersons.slice(0, 5);
  }

  private generateFindings(
    centrality: AnalyticsResult['centrality'],
    communities: AnalyticsResult['communities'],
    cycles: AnalyticsResult['cycles'],
    keyPersons: AnalyticsResult['keyPersons'],
    nodeMap: Map<string, GraphNode>,
  ): Finding[] {
    const findings: Finding[] = [];

    // Key persons
    if (keyPersons.length > 0) {
      findings.push({
        type: 'KEY_PERSON_RISK',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${keyPersons.length} key person(s) identified as network critical`,
        description: `Graph analysis identified ${keyPersons.length} entities that are critical to the network structure. ` +
          `These entities bridge different parts of the network — removing them would fragment it. ` +
          keyPersons.map((k) => `${k.label}: ${k.reason}`).join('. '),
        evidence: keyPersons.map((k) => k.reason),
        affectedEntities: keyPersons.map((k) => k.nodeId),
        recommendation: 'Key persons are single points of failure in the corporate structure. Assess concentration risk.',
      });
    }

    // Cycles
    if (cycles.length > 0) {
      findings.push({
        type: 'CIRCULAR_OWNERSHIP',
        severity: 'HIGH',
        confidence: 'MEDIUM',
        title: `${cycles.length} circular ownership/directorship pattern(s) detected`,
        description: `The network contains ${cycles.length} cycle(s) where ownership or directorship creates circular relationships. ` +
          `Circular structures can be used to obscure beneficial ownership or facilitate round-tripping.`,
        evidence: cycles.map((c) => `Cycle: ${c.labels.join(' → ')}`),
        affectedEntities: cycles.flatMap((c) => c.path).slice(0, 10),
        recommendation: 'Investigate the purpose of circular ownership structures. These are a red flag for money laundering and tax evasion.',
      });
    }

    // Large communities
    const largeCommunities = communities.filter((c) => c.size >= 5);
    if (largeCommunities.length > 1) {
      findings.push({
        type: 'NETWORK_CLUSTERS',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${largeCommunities.length} distinct clusters identified in the network`,
        description: `Community detection found ${largeCommunities.length} clusters of tightly connected entities. ` +
          `The largest cluster has ${largeCommunities[0]?.size || 0} entities. Multiple isolated clusters may indicate fragmented ownership.`,
        evidence: largeCommunities.slice(0, 3).map((c, i) => `Cluster ${i + 1}: ${c.size} entities`),
        affectedEntities: [],
        recommendation: 'Examine connections between clusters. Entities that bridge clusters are often the most important.',
      });
    }

    return findings;
  }
}
