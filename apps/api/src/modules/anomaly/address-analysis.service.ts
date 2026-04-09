import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export type AddressClass = 'CORPORATE_HQ' | 'BUSINESS_CENTER' | 'FORMATION_AGENT' | 'VIRTUAL_OFFICE' | 'RESIDENTIAL' | 'NORMAL';

export interface AddressAnalysis {
  density: number;
  dissolved: number;
  dissolutionRate: number;
  averageLifespanYears: number | null;
  hasEstablishedTenant: boolean;
  classification: AddressClass;
  // legacy field for backwards compat
  flag: AddressClass;
}

const FORMATION_PATTERNS = /(virtual|registered office|mail forwarding|formation|company services|business centre|business center|c\/o)/i;

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
      const dissolved = companies.filter((c) => /dissolved|liquidat|struck/i.test(c.metadata?.status || '')).length;
      const dissolutionRate = density > 0 ? dissolved / density : 0;

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
      const averageLifespanYears = lifespans.length > 0 ? lifespans.reduce((a, b) => a + b, 0) / lifespans.length : null;

      const hasEstablishedTenant = companies.some(
        (c) => c.metadata?.companyProfile === 'LARGE_PUBLIC' || c.metadata?.companyProfile === 'ESTABLISHED_PRIVATE',
      );

      // Classify
      let cls: AddressClass;
      const looksLikeFormationAgent = FORMATION_PATTERNS.test(addr.label || '');
      if (density >= 30 || (looksLikeFormationAgent && density >= 15)) {
        cls = 'FORMATION_AGENT';
      } else if (density >= 15 && dissolutionRate > 0.4) {
        cls = 'VIRTUAL_OFFICE';
      } else if (density >= 5 && density <= 20 && hasEstablishedTenant) {
        cls = 'BUSINESS_CENTER';
      } else if (density >= 1 && density <= 3 && hasEstablishedTenant) {
        cls = 'CORPORATE_HQ';
      } else if (density <= 2) {
        cls = 'RESIDENTIAL';
      } else {
        cls = 'NORMAL';
      }

      const analysis: AddressAnalysis = {
        density,
        dissolved,
        dissolutionRate,
        averageLifespanYears,
        hasEstablishedTenant,
        classification: cls,
        flag: cls,
      };
      addr.metadata = {
        ...(addr.metadata || {}),
        addressAnalysis: analysis,
        companyCount: density,
      };
      if (cls === 'FORMATION_AGENT' || cls === 'VIRTUAL_OFFICE') flagged++;
      await this.nodes.save(addr);
    }

    this.logger.log(`Analyzed ${addressNodes.length} addresses (${flagged} flagged)`);
    return { addresses: addressNodes.length, flagged };
  }
}
