import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Investigation } from '../investigation/entities/investigation.entity';

export interface CrossInvestigationHit {
  entityId: string;
  entityLabel: string;
  entityType: string;
  otherInvestigations: Array<{
    investigationId: string;
    companyName: string;
    riskScore: number;
  }>;
}

@Injectable()
export class CrossInvestigationService {
  private readonly logger = new Logger(CrossInvestigationService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
  ) {}

  async detect(investigationId: string): Promise<CrossInvestigationHit[]> {
    // Get all entities in this investigation
    const currentNodes = await this.nodes.find({ where: { investigationId } });
    if (currentNodes.length === 0) return [];

    // Get all other completed investigations
    const otherInvestigations = await this.investigations.find({
      where: { status: 'COMPLETE' as any },
    });
    const others = otherInvestigations.filter((inv) => inv.id !== investigationId);
    if (others.length === 0) return [];

    // Build label -> current nodes index (persons and companies only)
    const currentByLabel = new Map<string, GraphNode>();
    for (const n of currentNodes) {
      if (n.entityType === 'address') continue;
      if (n.label && n.label.length >= 4) {
        currentByLabel.set(n.label.toLowerCase().trim(), n);
      }
    }

    const hits: CrossInvestigationHit[] = [];
    const seenEntities = new Set<string>();

    for (const inv of others) {
      const otherNodes = await this.nodes.find({ where: { investigationId: inv.id } });
      const companyName = inv.metadata?.companyName || inv.query;
      const riskScore = inv.progress?.riskScore || 0;

      for (const other of otherNodes) {
        if (other.entityType === 'address') continue;
        const key = other.label?.toLowerCase().trim();
        if (!key || !currentByLabel.has(key)) continue;

        const current = currentByLabel.get(key)!;
        // Skip if same entity type doesn't match
        if (current.entityType !== other.entityType) continue;

        const entityKey = `${current.entityType}:${key}`;
        if (seenEntities.has(entityKey)) {
          // Add to existing hit
          const existing = hits.find((h) => h.entityId === current.entityId);
          if (existing && !existing.otherInvestigations.some((o) => o.investigationId === inv.id)) {
            existing.otherInvestigations.push({ investigationId: inv.id, companyName, riskScore });
          }
          continue;
        }
        seenEntities.add(entityKey);

        hits.push({
          entityId: current.entityId,
          entityLabel: current.label,
          entityType: current.entityType,
          otherInvestigations: [{ investigationId: inv.id, companyName, riskScore }],
        });
      }
    }

    // Tag nodes with cross-investigation data
    for (const hit of hits) {
      const node = currentNodes.find((n) => n.entityId === hit.entityId);
      if (node) {
        node.metadata = {
          ...(node.metadata || {}),
          crossInvestigations: hit.otherInvestigations,
        };
        await this.nodes.update(node.id, { metadata: node.metadata as any });
      }
    }

    this.logger.log(
      `CrossInvestigation ${investigationId}: ${hits.length} entities found in ${others.length} other investigation(s)`,
    );
    return hits;
  }
}
