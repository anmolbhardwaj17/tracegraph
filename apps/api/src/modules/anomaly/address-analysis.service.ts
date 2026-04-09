import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export type AddressFlag = 'VIRTUAL_OFFICE' | 'HIGH_DENSITY' | 'NORMAL';

export interface AddressAnalysis {
  density: number;
  dissolved: number;
  dissolutionRate: number;
  averageLifespanYears: number | null;
  flag: AddressFlag;
}

@Injectable()
export class AddressAnalysisService {
  private readonly logger = new Logger(AddressAnalysisService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async analyze(investigationId: string): Promise<{ addresses: number; flagged: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    const addressNodes = nodes.filter((n) => n.entityType === 'address');
    let flagged = 0;

    for (const addr of addressNodes) {
      const incoming = edges.filter(
        (e) =>
          e.relationshipType === 'address' &&
          (e.sourceNodeId === addr.id || e.targetNodeId === addr.id),
      );
      const companies: GraphNode[] = [];
      for (const e of incoming) {
        const otherId = e.sourceNodeId === addr.id ? e.targetNodeId : e.sourceNodeId;
        const other = byId.get(otherId);
        if (other && other.entityType === 'company') companies.push(other);
      }

      const density = companies.length;
      const dissolved = companies.filter((c) => /dissolved/i.test(c.metadata?.status || '')).length;
      const dissolutionRate = density > 0 ? dissolved / density : 0;

      // Average lifespan
      const lifespans: number[] = [];
      for (const c of companies) {
        const inc = c.metadata?.incorporationDate;
        const diss = c.metadata?.dissolutionDate;
        if (inc && diss) {
          lifespans.push(
            (new Date(diss).getTime() - new Date(inc).getTime()) / (1000 * 60 * 60 * 24 * 365),
          );
        }
      }
      const averageLifespanYears =
        lifespans.length > 0 ? lifespans.reduce((a, b) => a + b, 0) / lifespans.length : null;

      const flag: AddressFlag =
        density > 20 ? 'VIRTUAL_OFFICE' : density > 10 ? 'HIGH_DENSITY' : 'NORMAL';

      const analysis: AddressAnalysis = {
        density,
        dissolved,
        dissolutionRate,
        averageLifespanYears,
        flag,
      };
      addr.metadata = { ...(addr.metadata || {}), addressAnalysis: analysis };
      if (flag !== 'NORMAL') flagged++;
      await this.nodes.save(addr);
    }

    this.logger.log(`Analyzed ${addressNodes.length} addresses (${flagged} flagged)`);
    return { addresses: addressNodes.length, flagged };
  }
}
