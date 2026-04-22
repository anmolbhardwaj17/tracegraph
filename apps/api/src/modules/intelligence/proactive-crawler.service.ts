import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { Finding } from '../risk-scoring/finding.types';

/**
 * Phase VI: Proactive Crawling & Proprietary Data.
 *
 * Builds intelligence ACROSS investigations:
 * 1. Cross-investigation entity linking — same person in multiple investigations
 * 2. Address intelligence — density scoring across all investigations
 * 3. Director network expansion — find common directors
 *
 * This service is designed to run as a background job (BullMQ scheduled)
 * or triggered manually via API.
 */
@Injectable()
export class ProactiveCrawlerService {
  private readonly logger = new Logger(ProactiveCrawlerService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
  ) {}

  /**
   * Cross-investigation entity linking.
   * Finds entities that appear across multiple investigations.
   * Returns findings to add to the current investigation.
   */
  async crossLink(investigationId: string): Promise<{ links: CrossLink[]; findings: Finding[] }> {
    const currentNodes = await this.nodes.find({ where: { investigationId } });
    const links: CrossLink[] = [];
    const findings: Finding[] = [];

    // Get all completed investigations except current
    const otherInvs = await this.investigations.find({
      where: { status: 'COMPLETE' as any },
    });
    const otherIds = otherInvs.filter((i) => i.id !== investigationId).map((i) => i.id);
    if (otherIds.length === 0) return { links, findings };

    // For each person/company in current investigation, check if they appear elsewhere
    const entityLabels = currentNodes
      .filter((n) => n.entityType === 'person' || n.entityType === 'company')
      .map((n) => ({ id: n.id, label: n.label.toLowerCase().trim(), entityType: n.entityType, metadata: n.metadata }));

    for (const entity of entityLabels) {
      // Search by normalized name across all other investigations
      const matches = await this.nodes
        .createQueryBuilder('n')
        .where('n.investigationId != :invId', { invId: investigationId })
        .andWhere('n.entityType = :type', { type: entity.entityType })
        .andWhere('LOWER(TRIM(n.label)) = :label', { label: entity.label })
        .getMany();

      if (matches.length > 0) {
        const invIds = [...new Set(matches.map((m) => m.investigationId))];
        const invNames: string[] = [];
        for (const iid of invIds) {
          const inv = otherInvs.find((i) => i.id === iid);
          if (inv) invNames.push(inv.metadata?.companyName || inv.query);
        }

        links.push({
          entityId: entity.id,
          entityLabel: entity.label,
          entityType: entity.entityType,
          appearsIn: invIds.length,
          investigationNames: invNames,
        });

        // Update node metadata
        const meta = (entity.metadata || {}) as any;
        meta.crossInvestigations = invIds.length;
        meta.crossInvestigationNames = invNames;
        await this.nodes.update(entity.id, { metadata: meta }).catch(() => {});
      }
    }

    // Generate findings for significant cross-links
    const significantLinks = links.filter((l) => l.appearsIn >= 2);
    if (significantLinks.length > 0) {
      findings.push({
        type: 'CROSS_INVESTIGATION_LINK',
        severity: significantLinks.some((l) => l.appearsIn >= 3) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `${significantLinks.length} entity(ies) appear in other investigations`,
        description: `Cross-investigation analysis found ${significantLinks.length} entities that also appear in ${[...new Set(significantLinks.flatMap((l) => l.investigationNames))].length} other investigations. ` +
          `Recurring entities across multiple investigated companies may indicate a common network.`,
        evidence: significantLinks.slice(0, 5).map((l) =>
          `${l.entityLabel} (${l.entityType}) — appears in ${l.appearsIn} other investigations: ${l.investigationNames.join(', ')}`,
        ),
        affectedEntities: significantLinks.map((l) => l.entityId),
        recommendation: 'Entities appearing in multiple risk investigations warrant enhanced scrutiny. Check if they form a common network.',
      });
    }

    // Address intelligence
    const addressLinks = await this.buildAddressIntelligence(investigationId, currentNodes);
    if (addressLinks.length > 0) {
      findings.push({
        type: 'ADDRESS_HOTSPOT',
        severity: addressLinks.some((a) => a.density >= 10) ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `${addressLinks.length} address(es) appear in multiple investigations`,
        description: `Some addresses in this network have been seen in other investigations: ` +
          addressLinks.slice(0, 3).map((a) => `"${a.address}" (${a.density} companies across ${a.investigations} investigations)`).join('; '),
        evidence: addressLinks.map((a) => `${a.address}: ${a.density} companies in ${a.investigations} investigations`),
        affectedEntities: addressLinks.map((a) => a.nodeId),
        recommendation: 'High-density addresses that appear across investigations may be virtual offices or formation agent mills.',
      });
    }

    this.logger.log(`Cross-link complete: ${links.length} entities linked, ${findings.length} findings`);
    return { links, findings };
  }

  /** Build address density intelligence across all investigations */
  private async buildAddressIntelligence(
    investigationId: string,
    currentNodes: GraphNode[],
  ): Promise<Array<{ nodeId: string; address: string; density: number; investigations: number }>> {
    const addressNodes = currentNodes.filter((n) => n.entityType === 'address');
    const results: Array<{ nodeId: string; address: string; density: number; investigations: number }> = [];

    for (const addr of addressNodes) {
      const label = addr.label.toLowerCase().trim();
      if (label.length < 5) continue;

      // Count how many times this address appears across all investigations
      const matches = await this.nodes
        .createQueryBuilder('n')
        .where('n.entityType = :type', { type: 'address' })
        .andWhere('LOWER(TRIM(n.label)) = :label', { label })
        .getMany();

      if (matches.length >= 2) {
        const invIds = new Set(matches.map((m) => m.investigationId));
        results.push({
          nodeId: addr.id,
          address: addr.label,
          density: matches.length,
          investigations: invIds.size,
        });
      }
    }

    return results;
  }
}

export interface CrossLink {
  entityId: string;
  entityLabel: string;
  entityType: string;
  appearsIn: number;
  investigationNames: string[];
}
