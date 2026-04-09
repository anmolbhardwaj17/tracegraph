import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Investigation } from './entities/investigation.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';
import { INVESTIGATION_QUEUE, InvestigationJobData } from './investigation.processor';

@Injectable()
export class InvestigationService {
  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
    @InjectRepository(EntityMatch) private readonly matchesRepo: Repository<EntityMatch>,
    @InjectQueue(INVESTIGATION_QUEUE) private readonly queue: Queue<InvestigationJobData>,
  ) {}

  async create(query: string): Promise<Investigation> {
    const inv = await this.investigations.save(
      this.investigations.create({ query, status: 'QUEUED' }),
    );
    await this.queue.add('expand', { investigationId: inv.id, query }, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    return inv;
  }

  async findOne(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) throw new NotFoundException('Investigation not found');

    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const edges = await this.edges.find({ where: { investigationId: id } });
    const matches = await this.matchesRepo.find({
      where: { investigationId: id },
      order: { confidenceScore: 'DESC' },
    });
    const matchesByEntity = new Map<string, any[]>();
    for (const m of matches) {
      const list = matchesByEntity.get(m.sourceEntityId) || [];
      list.push({
        id: m.id,
        source: m.matchedSource,
        matchedEntityId: m.matchedEntityId,
        confidence: m.confidenceScore,
        reasons: m.matchReasons,
      });
      matchesByEntity.set(m.sourceEntityId, list);
    }

    const grouped: Record<string, any[]> = { company: [], person: [], address: [] };
    for (const n of nodes) {
      (grouped[n.entityType] ||= []).push({
        id: n.id,
        entityId: n.entityId,
        label: n.label,
        metadata: n.metadata,
        proximityScore: n.proximityScore,
        proximityHops: n.proximityHops,
        matches: matchesByEntity.get(n.entityId) || [],
      });
    }

    return {
      id: inv.id,
      query: inv.query,
      status: inv.status,
      createdAt: inv.createdAt,
      completedAt: inv.completedAt,
      progress: inv.progress,
      riskScore: inv.progress?.riskScore,
      findings: inv.progress?.findings || [],
      error: inv.metadata?.error,
      rootCompanyNumber: inv.metadata?.companyNumber,
      counts: {
        companies: grouped.company.length,
        people: grouped.person.length,
        addresses: grouped.address.length,
        edges: edges.length,
      },
      entities: grouped,
      matches: matches.map((m) => ({
        id: m.id,
        sourceEntityType: m.sourceEntityType,
        sourceEntityId: m.sourceEntityId,
        source: m.matchedSource,
        matchedEntityId: m.matchedEntityId,
        confidence: m.confidenceScore,
        reasons: m.matchReasons,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        type: e.relationshipType,
        metadata: e.metadata,
      })),
    };
  }
}
