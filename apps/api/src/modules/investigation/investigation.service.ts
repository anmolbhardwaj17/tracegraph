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

  async create(query: string, tier: 'QUICK' | 'STANDARD' | 'DEEP' = 'STANDARD'): Promise<Investigation> {
    const inv = await this.investigations.save(
      this.investigations.create({ query, status: 'QUEUED', tier }),
    );
    await this.queue.add('expand', { investigationId: inv.id, query, tier } as any, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    return inv;
  }

  async list(): Promise<any[]> {
    const items = await this.investigations.find({
      order: { createdAt: 'DESC' },
      take: 25,
    });
    return items.map((i) => ({
      id: i.id,
      query: i.query,
      companyName: i.metadata?.companyName,
      status: i.status,
      tier: i.tier,
      createdAt: i.createdAt,
      completedAt: i.completedAt,
      riskScore: i.progress?.riskScore,
      counts: i.progress
        ? {
            entities: i.progress.entitiesDiscovered,
            edges: i.progress.edgesCreated,
          }
        : undefined,
    }));
  }

  async graphFor(id: string): Promise<any> {
    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const edges = await this.edges.find({ where: { investigationId: id } });
    const matches = await this.matchesRepo.find({ where: { investigationId: id } });
    const matchedEntityIds = new Set(matches.map((m) => m.sourceEntityId));

    // Connection counts (degree)
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) || 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) || 0) + 1);
    }

    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        entityType: n.entityType,
        label: n.label,
        degree: degree.get(n.id) || 0,
        proximityScore: n.proximityScore,
        proximityHops: n.proximityHops,
        shellRisk: n.metadata?.shellCompanyScore?.risk,
        shellScore: n.metadata?.shellCompanyScore?.score,
        addressFlag: n.metadata?.addressAnalysis?.flag,
        jurisdictionRisk: n.metadata?.jurisdictionRisk?.risk,
        jurisdictionName: n.metadata?.jurisdictionRisk?.matched || n.metadata?.jurisdictionRisk?.raw,
        hasMatch: matchedEntityIds.has(n.entityId),
        metadata: n.metadata,
      })),
      links: edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        type: e.relationshipType,
      })),
    };
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

    // Compute degree per node from edges
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) || 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) || 0) + 1);
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
        degree: degree.get(n.id) || 0,
        matches: matchesByEntity.get(n.entityId) || [],
      });
    }

    return {
      id: inv.id,
      query: inv.query,
      status: inv.status,
      tier: inv.tier,
      companyName: inv.metadata?.companyName,
      createdAt: inv.createdAt,
      completedAt: inv.completedAt,
      progress: inv.progress,
      riskScore: inv.progress?.riskScore,
      findings: inv.progress?.findings || [],
      uboChains: inv.progress?.uboChains || [],
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

  /**
   * Compare two investigations side by side. Finds shared directors, shared
   * addresses, and merges the two graph datasets.
   */
  async compare(invIdA: string, invIdB: string): Promise<any> {
    const [a, b] = await Promise.all([this.findOne(invIdA), this.findOne(invIdB)]);

    // Normalise label for matching
    const norm = (s: string) => (s || '').toLowerCase().trim();

    // Shared directors (by normalised name)
    const personsA = (a.entities?.person || []) as any[];
    const personsB = (b.entities?.person || []) as any[];
    const labelsA = new Map(personsA.map((p: any) => [norm(p.label), p]));
    const sharedDirectors: any[] = [];
    for (const p of personsB) {
      const match = labelsA.get(norm(p.label));
      if (match) sharedDirectors.push({ label: p.label, inA: match, inB: p });
    }

    // Shared addresses (by normalised label)
    const addrsA = (a.entities?.address || []) as any[];
    const addrsB = (b.entities?.address || []) as any[];
    const addrLabelsA = new Map(addrsA.map((p: any) => [norm(p.label), p]));
    const sharedAddresses: any[] = [];
    for (const p of addrsB) {
      const match = addrLabelsA.get(norm(p.label));
      if (match) sharedAddresses.push({ label: p.label, inA: match, inB: p });
    }

    // Severity breakdown
    const sevBreakdown = (findings: any[]) => {
      const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
      for (const f of findings || []) c[f.severity as keyof typeof c]++;
      return c;
    };

    return {
      a: {
        id: a.id,
        query: a.query,
        companyName: a.companyName,
        riskScore: a.riskScore,
        findingsCount: (a.findings || []).length,
        severityBreakdown: sevBreakdown(a.findings),
        counts: a.counts,
      },
      b: {
        id: b.id,
        query: b.query,
        companyName: b.companyName,
        riskScore: b.riskScore,
        findingsCount: (b.findings || []).length,
        severityBreakdown: sevBreakdown(b.findings),
        counts: b.counts,
      },
      sharedDirectors: sharedDirectors.map((s) => ({ label: s.label })),
      sharedAddresses: sharedAddresses.map((s) => ({ label: s.label })),
      sharedDirectorsCount: sharedDirectors.length,
      sharedAddressesCount: sharedAddresses.length,
    };
  }
}
