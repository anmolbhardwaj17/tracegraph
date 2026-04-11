import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { classifyJurisdiction } from './jurisdiction-risk.service';

export interface OpacityScore {
  score: number;
  band: 'TRANSPARENT' | 'MODERATE' | 'OPAQUE' | 'HIGHLY_OPAQUE';
  reasons: string[];
}

@Injectable()
export class OwnershipOpacityService {
  private readonly logger = new Logger(OwnershipOpacityService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async scoreAll(investigationId: string, uboChains?: any[]): Promise<{ scored: number; opaque: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const companies = nodes.filter((n) => n.entityType === 'company');

    let scored = 0;
    let opaque = 0;

    // Build PSC edge map: company -> PSC nodes
    const pscEdges = edges.filter((e) => e.relationshipType === 'psc');
    const companyPscs = new Map<string, GraphNode[]>();
    for (const e of pscEdges) {
      const companyId = companies.find((c) => c.id === e.sourceNodeId) ? e.sourceNodeId
        : companies.find((c) => c.id === e.targetNodeId) ? e.targetNodeId : null;
      const pscId = companyId ? (e.sourceNodeId === companyId ? e.targetNodeId : e.sourceNodeId) : null;
      if (!companyId || !pscId) continue;
      const pscNode = nodes.find((n) => n.id === pscId);
      if (!pscNode) continue;
      const list = companyPscs.get(companyId) || [];
      list.push(pscNode);
      companyPscs.set(companyId, list);
    }

    // Build UBO chain lookup by root company number
    const chainsByCompany = new Map<string, any[]>();
    if (uboChains) {
      for (const chain of uboChains) {
        const key = chain.rootCompanyNumber;
        const list = chainsByCompany.get(key) || [];
        list.push(chain);
        chainsByCompany.set(key, list);
      }
    }

    for (const c of companies) {
      let score = 0;
      const reasons: string[] = [];
      const pscs = companyPscs.get(c.id) || [];

      // 1. No PSCs filed
      if (pscs.length === 0) {
        score += 30;
        reasons.push('No PSCs filed');
      }

      // 2. Corporate PSCs
      const corporatePscs = pscs.filter((p) =>
        p.metadata?.kind?.includes('corporate') || p.metadata?.kind?.includes('legal-person'),
      );
      if (corporatePscs.length > 0) {
        score += corporatePscs.length * 10;
        reasons.push(`${corporatePscs.length} corporate PSC(s) - not natural persons`);
      }

      // 3. PSC exemptions or unconfirmed
      const exemptions = pscs.filter((p) => {
        const kind = (p.metadata?.kind || '').toLowerCase();
        return kind.includes('exemption') || kind.includes('statement') || kind.includes('super-secure');
      });
      if (exemptions.length > 0) {
        score += 15;
        reasons.push('PSC exemption or unconfirmed statement filed');
      }

      // 4-6. UBO chain analysis
      const chains = chainsByCompany.get(c.entityId) || [];
      if (chains.length > 0) {
        // Dead ends
        const deadEnds = chains.filter((ch: any) => ch.flags?.includes('DEAD_END'));
        if (deadEnds.length > 0) {
          score += 20;
          reasons.push(`${deadEnds.length} UBO chain(s) hit dead end - cannot trace to human`);
        }

        // Deep chains (>3 layers)
        const deepChains = chains.filter((ch: any) => (ch.path?.length || 0) > 4);
        if (deepChains.length > 0) {
          score += 10;
          reasons.push(`UBO chain exceeds 3 layers deep`);
        }

        // Offshore jurisdiction in chain
        const offshoreChains = chains.filter((ch: any) =>
          ch.flags?.includes('OFFSHORE') || ch.path?.some((n: any) =>
            classifyJurisdiction(n.jurisdiction).risk === 'HIGH',
          ),
        );
        if (offshoreChains.length > 0) {
          score += 15;
          reasons.push(`UBO chain passes through high-risk jurisdiction`);
        }
      } else if (corporatePscs.length > 0) {
        // No UBO chains built but has corporate PSCs - likely unresolvable
        score += 15;
        reasons.push('Corporate PSC with no UBO chain traced');
      }

      score = Math.min(100, score);
      const band: OpacityScore['band'] =
        score >= 75 ? 'HIGHLY_OPAQUE' :
        score >= 50 ? 'OPAQUE' :
        score >= 25 ? 'MODERATE' :
        'TRANSPARENT';

      const opacity: OpacityScore = { score, band, reasons };
      c.metadata = { ...(c.metadata || {}), ownershipOpacity: opacity };
      await this.nodes.update(c.id, { metadata: c.metadata as any });
      scored++;
      if (score > 50) opaque++;
    }

    this.logger.log(`OwnershipOpacity ${investigationId}: scored=${scored} opaque=${opaque}`);
    return { scored, opaque };
  }
}
