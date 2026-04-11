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
    return items.map((i) => this.toListItem(i));
  }

  async listPaginated(opts: {
    page: number;
    limit: number;
    risk?: string;
    status?: string;
    search?: string;
    from?: string;
    to?: string;
  }): Promise<{ items: any[]; total: number; page: number; limit: number }> {
    const qb = this.investigations.createQueryBuilder('i').orderBy('i.createdAt', 'DESC');

    if (opts.status) {
      qb.andWhere('i.status = :status', { status: opts.status });
    }
    if (opts.search) {
      qb.andWhere("(i.query ILIKE :q OR i.metadata->>'companyName' ILIKE :q)", { q: `%${opts.search}%` });
    }
    if (opts.from) {
      qb.andWhere('i.createdAt >= :from', { from: opts.from });
    }
    if (opts.to) {
      qb.andWhere('i.createdAt <= :to', { to: opts.to });
    }

    const [items, total] = await qb
      .skip((opts.page - 1) * opts.limit)
      .take(opts.limit)
      .getManyAndCount();

    let mapped = items.map((i) => this.toListItem(i));

    // Client-side risk filter (risk score lives in jsonb, not easy to query directly)
    if (opts.risk) {
      const band = opts.risk.toUpperCase();
      mapped = mapped.filter((m) => {
        const s = m.riskScore ?? 0;
        if (band === 'CRITICAL') return s >= 75;
        if (band === 'HIGH') return s >= 50 && s < 75;
        if (band === 'MEDIUM') return s >= 25 && s < 50;
        if (band === 'LOW') return s < 25;
        return true;
      });
    }

    return { items: mapped, total, page: opts.page, limit: opts.limit };
  }

  async updateBenchmarks(): Promise<void> {
    const all = await this.investigations.find({ where: { status: 'COMPLETE' } });
    const scores = all.map((i) => i.progress?.riskScore).filter((s): s is number => s != null).sort((a, b) => a - b);
    if (scores.length === 0) return;
    const total = scores.length;
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / total);
    const median = scores[Math.floor(total / 2)];
    const low = Math.round((scores.filter((s) => s < 25).length / total) * 100);
    const medium = Math.round((scores.filter((s) => s >= 25 && s < 50).length / total) * 100);
    const high = Math.round((scores.filter((s) => s >= 50 && s < 75).length / total) * 100);
    const critical = Math.round((scores.filter((s) => s >= 75).length / total) * 100);
    await this.investigations.query(
      `UPDATE investigation_benchmarks SET "totalInvestigations"=$1, "avgScore"=$2, "medianScore"=$3, "lowPct"=$4, "mediumPct"=$5, "highPct"=$6, "criticalPct"=$7, "updatedAt"=now() WHERE id=1`,
      [total, avg, median, low, medium, high, critical],
    );
  }

  async getBenchmarks(): Promise<any> {
    try {
      const rows = await this.investigations.query(`SELECT * FROM investigation_benchmarks WHERE id=1`);
      return rows[0] || null;
    } catch { return null; }
  }

  async getPercentile(score: number): Promise<number> {
    const all = await this.investigations.find({ where: { status: 'COMPLETE' } });
    const scores = all.map((i) => i.progress?.riskScore).filter((s): s is number => s != null);
    if (scores.length < 2) return 0;
    const below = scores.filter((s) => s < score).length;
    return Math.round((below / scores.length) * 100);
  }

  async stats(): Promise<any> {
    const total = await this.investigations.count();
    const completed = await this.investigations.count({ where: { status: 'COMPLETE' } });
    const allComplete = await this.investigations.find({ where: { status: 'COMPLETE' } });

    let avgScore = 0;
    const findingCounts: Record<string, number> = {};
    let scored = 0;
    for (const inv of allComplete) {
      const s = inv.progress?.riskScore;
      if (s != null) { avgScore += s; scored++; }
      for (const f of inv.progress?.findings || []) {
        findingCounts[f.type] = (findingCounts[f.type] || 0) + 1;
      }
    }
    if (scored > 0) avgScore = Math.round(avgScore / scored);

    const topFindings = Object.entries(findingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return { total, completed, avgScore, topFindings };
  }

  private toListItem(i: Investigation) {
    return {
      id: i.id,
      query: i.query,
      companyName: i.metadata?.companyName,
      status: i.status,
      tier: i.tier,
      createdAt: i.createdAt,
      completedAt: i.completedAt,
      riskScore: i.progress?.riskScore,
      counts: i.progress
        ? { entities: i.progress.entitiesDiscovered, edges: i.progress.edgesCreated }
        : undefined,
    };
  }

  async remove(id: string): Promise<void> {
    await this.matchesRepo.delete({ investigationId: id });
    await this.edges.delete({ investigationId: id });
    await this.nodes.delete({ investigationId: id });
    await this.investigations.delete(id);
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
        isFormationAgent: n.metadata?.isFormationAgent || false,
        ownershipOpacity: n.metadata?.ownershipOpacity?.score,
        opacityBand: n.metadata?.ownershipOpacity?.band,
        directorVelocity: n.metadata?.directorVelocity,
        crossInvestigations: n.metadata?.crossInvestigations,
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
      benchmarks: await this.getBenchmarks(),
      percentile: inv.progress?.riskScore != null ? await this.getPercentile(inv.progress.riskScore) : null,
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

  // ========== SPLIT ENDPOINTS ==========

  /** Lightweight meta - used by the shared layout */
  async getMeta(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return null;
    const nodeCount = await this.nodes.count({ where: { investigationId: id } });
    const edgeCount = await this.edges.count({ where: { investigationId: id } });
    return {
      id: inv.id, query: inv.query, status: inv.status, tier: inv.tier,
      companyName: inv.metadata?.companyName,
      rootCompanyNumber: inv.metadata?.companyNumber,
      createdAt: inv.createdAt, completedAt: inv.completedAt,
      riskScore: inv.progress?.riskScore,
      counts: { entities: nodeCount, edges: edgeCount },
    };
  }

  /** Overview: score, breakdown, benchmarks */
  async getOverview(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return null;
    return {
      riskScore: inv.progress?.riskScore,
      riskClassification: inv.progress?.riskClassification,
      scoreBreakdown: inv.progress?.scoreBreakdown,
      findings: inv.progress?.findings || [],
      uboChains: inv.progress?.uboChains || [],
      benchmarks: await this.getBenchmarks(),
      percentile: inv.progress?.riskScore != null ? await this.getPercentile(inv.progress.riskScore) : null,
      counts: {
        companies: await this.nodes.count({ where: { investigationId: id, entityType: 'company' } }),
        people: await this.nodes.count({ where: { investigationId: id, entityType: 'person' } }),
        addresses: await this.nodes.count({ where: { investigationId: id, entityType: 'address' } }),
      },
    };
  }

  /** Findings only */
  async getFindings(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return { findings: [] };
    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const grouped: Record<string, any[]> = { company: [], person: [], address: [] };
    for (const n of nodes) (grouped[n.entityType] ||= []).push({ id: n.id, entityId: n.entityId, label: n.label });
    return { findings: inv.progress?.findings || [], entities: grouped };
  }

  /** Entities - paginated by type */
  async getEntities(id: string, type?: string, page = 1, limit = 50): Promise<any> {
    const where: any = { investigationId: id };
    if (type && ['company', 'person', 'address'].includes(type)) where.entityType = type;

    const [items, total] = await this.nodes.findAndCount({
      where, skip: (page - 1) * limit, take: limit,
    });

    const edges = await this.edges.find({ where: { investigationId: id } });
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) || 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) || 0) + 1);
    }

    const matches = await this.matchesRepo.find({ where: { investigationId: id } });
    const matchedEntityIds = new Set(matches.map((m) => m.sourceEntityId));

    return {
      items: items.map((n) => ({
        id: n.id, entityId: n.entityId, label: n.label, entityType: n.entityType,
        metadata: n.metadata, proximityScore: n.proximityScore,
        degree: degree.get(n.id) || 0,
        matches: matchedEntityIds.has(n.entityId) ? matches.filter((m) => m.sourceEntityId === n.entityId) : [],
      })),
      total, page, limit,
    };
  }

  /** Matches only */
  async getMatches(id: string): Promise<any> {
    const matches = await this.matchesRepo.find({
      where: { investigationId: id }, order: { confidenceScore: 'DESC' },
    });
    return {
      matches: matches.map((m) => ({
        id: m.id, sourceEntityType: m.sourceEntityType, sourceEntityId: m.sourceEntityId,
        source: m.matchedSource, matchedEntityId: m.matchedEntityId,
        confidence: m.confidenceScore, reasons: m.matchReasons,
      })),
    };
  }

  /** UBO chains */
  async getUbo(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    return { chains: inv?.progress?.uboChains || [] };
  }

  /** Locations (addresses + relevant edges) */
  async getLocations(id: string): Promise<any> {
    const addresses = await this.nodes.find({ where: { investigationId: id, entityType: 'address' } });
    const edges = await this.edges.find({ where: { investigationId: id } });
    const companies = await this.nodes.find({ where: { investigationId: id, entityType: 'company' } });
    return {
      addresses: addresses.map((n) => ({
        id: n.id, entityId: n.entityId, label: n.label, metadata: n.metadata, proximityScore: n.proximityScore,
      })),
      edges: edges.filter((e) => e.relationshipType === 'address').map((e) => ({
        id: e.id, source: e.sourceNodeId, target: e.targetNodeId, type: e.relationshipType,
      })),
      companies: { company: companies.map((c) => ({ id: c.id, entityId: c.entityId, label: c.label })) },
    };
  }

  /** Timeline events - paginated */
  async getTimeline(id: string, page = 1, limit = 100): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return { events: [], total: 0 };

    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const edges = await this.edges.find({ where: { investigationId: id } });
    const events: any[] = [];

    // Company events
    for (const n of nodes) {
      if (n.entityType !== 'company') continue;
      if (n.metadata?.incorporationDate) events.push({ date: n.metadata.incorporationDate, type: 'incorporation', title: `${n.label} incorporated`, severity: 'info' });
      if (n.metadata?.dissolutionDate) events.push({ date: n.metadata.dissolutionDate, type: 'dissolution', title: `${n.label} dissolved`, severity: 'warning' });
    }

    // Director events
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const person = nodes.find((n) => n.id === e.sourceNodeId && n.entityType === 'person') || nodes.find((n) => n.id === e.targetNodeId && n.entityType === 'person');
      const company = nodes.find((n) => n.id === e.sourceNodeId && n.entityType === 'company') || nodes.find((n) => n.id === e.targetNodeId && n.entityType === 'company');
      if (e.metadata?.appointedOn) events.push({ date: e.metadata.appointedOn, type: 'appointment', title: `${person?.label || 'Director'} appointed`, detail: company?.label, severity: 'info' });
      if (e.metadata?.resignedOn) events.push({ date: e.metadata.resignedOn, type: 'resignation', title: `${person?.label || 'Director'} resigned`, detail: company?.label, severity: 'info' });
    }

    // Findings as events
    for (const f of inv.progress?.findings || []) {
      events.push({ date: '', type: 'anomaly', title: f.title, detail: f.type, severity: f.severity === 'CRITICAL' ? 'critical' : f.severity === 'HIGH' ? 'warning' : 'info' });
    }

    events.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      if (ta && tb) return ta - tb;
      if (ta) return -1;
      return 1;
    });

    const total = events.length;
    const paginated = events.slice((page - 1) * limit, page * limit);
    return { events: paginated, total, page, limit };
  }
}
