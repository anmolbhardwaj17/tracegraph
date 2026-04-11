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
    const inv = await this.investigations.findOne({ where: { id } });
    const rootCompanyNumber = inv?.metadata?.companyNumber;
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

    // Find the root node ID
    const rootNode = nodes.find((n) => n.entityType === 'company' && n.entityId === rootCompanyNumber);

    return {
      rootNodeId: rootNode?.id || null,
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

  // ========== HELPERS ==========

  /** Compute each node's relationship to the target company */
  private async computeRelations(investigationId: string): Promise<Map<string, string>> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    const rootNumber = inv?.metadata?.companyNumber;
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    const relations = new Map<string, string>();
    const rootNode = nodes.find((n) => n.entityType === 'company' && n.entityId === rootNumber);
    if (!rootNode) return relations;

    relations.set(rootNode.id, 'Target');

    // Direct connections
    const directEdges = edges.filter((e) => e.sourceNodeId === rootNode.id || e.targetNodeId === rootNode.id);
    for (const e of directEdges) {
      const otherId = e.sourceNodeId === rootNode.id ? e.targetNodeId : e.sourceNodeId;
      const other = nodes.find((n) => n.id === otherId);
      if (!other || relations.has(otherId)) continue;
      if (e.relationshipType === 'director' || e.relationshipType === 'appointment') {
        relations.set(otherId, 'Director');
      } else if (e.relationshipType === 'psc') {
        relations.set(otherId, 'PSC/Owner');
      } else if (e.relationshipType === 'address') {
        relations.set(otherId, 'Address');
      } else {
        relations.set(otherId, 'Direct');
      }
    }

    // Depth 2: companies of directors
    const directorIds = new Set<string>();
    for (const [id, rel] of relations) {
      if (rel === 'Director') directorIds.add(id);
    }
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const personId = directorIds.has(e.sourceNodeId) ? e.sourceNodeId : directorIds.has(e.targetNodeId) ? e.targetNodeId : null;
      if (!personId) continue;
      const companyId = e.sourceNodeId === personId ? e.targetNodeId : e.sourceNodeId;
      if (!relations.has(companyId)) {
        relations.set(companyId, "Director's company");
      }
    }

    // Everything else is indirect
    for (const n of nodes) {
      if (!relations.has(n.id)) relations.set(n.id, 'Network');
    }

    return relations;
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

  /** Overview: score, breakdown, benchmarks, target-focused */
  async getOverview(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return null;
    const targetName = inv.metadata?.companyName || inv.query;
    return {
      targetCompany: targetName,
      rootCompanyNumber: inv.metadata?.companyNumber,
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

  /** Findings with relationship context */
  async getFindings(id: string): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return { findings: [], entities: { company: [], person: [], address: [] }, relations: {}, targetNodeId: null, targetCompanyName: null };
    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const grouped: Record<string, any[]> = { company: [], person: [], address: [] };
    for (const n of nodes) (grouped[n.entityType] ||= []).push({ id: n.id, entityId: n.entityId, label: n.label, metadata: n.metadata });

    // Compute relations so frontend can group findings by relevance
    const relations = await this.computeRelations(id);
    const relationsObj: Record<string, string> = {};
    for (const [nodeId, rel] of relations) relationsObj[nodeId] = rel;

    // Find target node ID
    const rootNumber = inv.metadata?.companyNumber;
    const rootNode = nodes.find((n) => n.entityType === 'company' && n.entityId === rootNumber);

    return {
      findings: inv.progress?.findings || [],
      entities: grouped,
      relations: relationsObj,
      targetNodeId: rootNode?.id || null,
      targetCompanyName: inv.metadata?.companyName || inv.query,
    };
  }

  /** Entities - paginated by type, with relationship to target */
  async getEntities(id: string, type?: string, page = 1, limit = 50): Promise<any> {
    const where: any = { investigationId: id };
    if (type && ['company', 'person', 'address'].includes(type)) where.entityType = type;

    const allNodes = await this.nodes.find({ where });

    const edges = await this.edges.find({ where: { investigationId: id } });
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.sourceNodeId, (degree.get(e.sourceNodeId) || 0) + 1);
      degree.set(e.targetNodeId, (degree.get(e.targetNodeId) || 0) + 1);
    }

    const matches = await this.matchesRepo.find({ where: { investigationId: id } });
    const matchedEntityIds = new Set(matches.map((m) => m.sourceEntityId));
    const relations = await this.computeRelations(id);

    // Sort by relationship relevance
    const REL_ORDER: Record<string, number> = { Target: 0, Director: 1, 'PSC/Owner': 2, Address: 3, Direct: 4, "Director's company": 5, Network: 6 };
    const sorted = allNodes.sort((a, b) => {
      const ra = REL_ORDER[relations.get(a.id) || 'Network'] ?? 6;
      const rb = REL_ORDER[relations.get(b.id) || 'Network'] ?? 6;
      if (ra !== rb) return ra - rb;
      return (degree.get(b.id) || 0) - (degree.get(a.id) || 0);
    });

    const total = sorted.length;
    const paginated = sorted.slice((page - 1) * limit, page * limit);

    return {
      items: paginated.map((n) => ({
        id: n.id, entityId: n.entityId, label: n.label, entityType: n.entityType,
        metadata: n.metadata, proximityScore: n.proximityScore,
        degree: degree.get(n.id) || 0,
        relationToTarget: relations.get(n.id) || 'Network',
        matches: matchedEntityIds.has(n.entityId) ? matches.filter((m) => m.sourceEntityId === n.entityId) : [],
      })),
      total, page, limit,
    };
  }

  /** Matches with relation to target */
  async getMatches(id: string): Promise<any> {
    const matches = await this.matchesRepo.find({
      where: { investigationId: id }, order: { confidenceScore: 'DESC' },
    });
    const relations = await this.computeRelations(id);
    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const inv = await this.investigations.findOne({ where: { id } });
    const targetName = inv?.metadata?.companyName || '';

    return {
      targetCompany: targetName,
      matches: matches.map((m) => {
        const node = nodes.find((n) => n.entityId === m.sourceEntityId);
        const rel = node ? (relations.get(node.id) || 'Network') : 'Network';
        return {
          id: m.id, sourceEntityType: m.sourceEntityType, sourceEntityId: m.sourceEntityId,
          source: m.matchedSource, matchedEntityId: m.matchedEntityId,
          confidence: m.confidenceScore, reasons: m.matchReasons,
          relationToTarget: rel,
          entityLabel: node?.label,
        };
      }).sort((a, b) => {
        // Directors first, then by confidence
        const REL: Record<string, number> = { Target: 0, Director: 1, 'PSC/Owner': 2, Direct: 3, "Director's company": 4, Network: 5 };
        const ra = REL[a.relationToTarget] ?? 5;
        const rb = REL[b.relationToTarget] ?? 5;
        if (ra !== rb) return ra - rb;
        return b.confidence - a.confidence;
      }),
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

  /** Timeline events - scoped to target company + direct connections only */
  async getTimeline(id: string, page = 1, limit = 200, fullHistory = false): Promise<any> {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return { events: [], total: 0, keyMoments: [] };

    const rootCompanyNumber = inv.metadata?.companyNumber;
    const nodes = await this.nodes.find({ where: { investigationId: id } });
    const edges = await this.edges.find({ where: { investigationId: id } });
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    // Find the root company node
    const rootNode = nodes.find((n) => n.entityType === 'company' && n.entityId === rootCompanyNumber);
    if (!rootNode) return { events: [], total: 0, keyMoments: [] };

    // Build depth-1 set: root company + its direct connections
    const directEdges = edges.filter((e) => e.sourceNodeId === rootNode.id || e.targetNodeId === rootNode.id);
    const depth1Ids = new Set<string>([rootNode.id]);
    for (const e of directEdges) {
      depth1Ids.add(e.sourceNodeId);
      depth1Ids.add(e.targetNodeId);
    }

    // Directors of the root company
    const rootDirectorIds = new Set<string>();
    for (const e of directEdges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const other = e.sourceNodeId === rootNode.id ? e.targetNodeId : e.sourceNodeId;
      const otherNode = nodeById.get(other);
      if (otherNode?.entityType === 'person') rootDirectorIds.add(other);
    }

    // Companies of root directors (for track record context)
    const directorCompanyIds = new Set<string>();
    const directorCompanyCount = new Map<string, number>();
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const personId = nodeById.get(e.sourceNodeId)?.entityType === 'person' ? e.sourceNodeId
        : nodeById.get(e.targetNodeId)?.entityType === 'person' ? e.targetNodeId : null;
      const companyId = e.sourceNodeId === personId ? e.targetNodeId : e.sourceNodeId;
      if (!personId || !rootDirectorIds.has(personId)) continue;
      directorCompanyIds.add(companyId);
      directorCompanyCount.set(personId, (directorCompanyCount.get(personId) || 0) + 1);
    }

    // Affected entity IDs from findings (for depth 2+ inclusion)
    const findingEntityIds = new Set<string>();
    for (const f of inv.progress?.findings || []) {
      for (const eid of f.affectedEntities || []) {
        const node = nodes.find((n) => n.entityId === eid);
        if (node) findingEntityIds.add(node.id);
      }
    }

    // Time window: 2 years before incorporation to now
    const incDate = rootNode.metadata?.incorporationDate ? new Date(rootNode.metadata.incorporationDate).getTime() : 0;
    const windowStart = fullHistory ? 0 : (incDate ? incDate - 2 * 365 * 24 * 60 * 60 * 1000 : 0);
    const windowEnd = Date.now();

    const events: any[] = [];

    // 1. Target company events
    if (rootNode.metadata?.incorporationDate) {
      events.push({
        date: rootNode.metadata.incorporationDate, type: 'incorporation', severity: 'info',
        title: `${rootNode.label} incorporated`,
        context: directorCompanyCount.size > 0 ? `By directors with ${[...directorCompanyCount.values()].reduce((a, b) => a + b, 0)} total company appointments` : undefined,
      });
    }
    if (rootNode.metadata?.dissolutionDate) {
      events.push({ date: rootNode.metadata.dissolutionDate, type: 'dissolution', severity: 'critical', title: `${rootNode.label} dissolved` });
    }

    // 2. Director appointments/resignations AT the target company
    for (const e of directEdges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const personId = nodeById.get(e.sourceNodeId)?.entityType === 'person' ? e.sourceNodeId : e.targetNodeId;
      const person = nodeById.get(personId);
      if (!person) continue;
      const otherCount = directorCompanyCount.get(personId) || 0;

      if (e.metadata?.appointedOn) {
        events.push({
          date: e.metadata.appointedOn, type: 'appointment', severity: 'info',
          title: `${person.label} appointed as director`,
          context: otherCount > 1 ? `Also serves as director of ${otherCount - 1} other companies` : undefined,
        });
      }
      if (e.metadata?.resignedOn) {
        events.push({
          date: e.metadata.resignedOn, type: 'resignation', severity: 'warning',
          title: `${person.label} resigned as director`,
        });
      }
    }

    // 3. PSC changes at target company
    for (const e of directEdges) {
      if (e.relationshipType !== 'psc') continue;
      const pscId = e.sourceNodeId === rootNode.id ? e.targetNodeId : e.sourceNodeId;
      const psc = nodeById.get(pscId);
      if (!psc) continue;
      events.push({
        date: e.metadata?.notifiedOn || '', type: 'psc', severity: 'info',
        title: `${psc.label} registered as PSC`,
        context: psc.metadata?.kind?.includes('corporate') ? 'Corporate entity - not a natural person' : undefined,
      });
    }

    // 4. Director's OTHER companies: incorporation + dissolution (track record)
    for (const compId of directorCompanyIds) {
      if (compId === rootNode.id) continue;
      const comp = nodeById.get(compId);
      if (!comp) continue;

      // Find which director connects this company
      const directorLabel = (() => {
        for (const e of edges) {
          if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
          const pId = nodeById.get(e.sourceNodeId)?.entityType === 'person' ? e.sourceNodeId : e.targetNodeId;
          const cId = e.sourceNodeId === pId ? e.targetNodeId : e.sourceNodeId;
          if (cId === compId && rootDirectorIds.has(pId)) return nodeById.get(pId)?.label;
        }
        return null;
      })();

      if (comp.metadata?.incorporationDate) {
        events.push({
          date: comp.metadata.incorporationDate, type: 'incorporation', severity: 'info',
          title: `${comp.label} incorporated`,
          context: directorLabel ? `Directed by ${directorLabel} who is also director of ${rootNode.label}` : undefined,
        });
      }
      if (comp.metadata?.dissolutionDate) {
        const lifespanMs = comp.metadata.incorporationDate
          ? new Date(comp.metadata.dissolutionDate).getTime() - new Date(comp.metadata.incorporationDate).getTime()
          : 0;
        const lifespanMonths = lifespanMs > 0 ? Math.round(lifespanMs / (30 * 24 * 60 * 60 * 1000)) : 0;
        events.push({
          date: comp.metadata.dissolutionDate, type: 'dissolution', severity: 'warning',
          title: `${comp.label} dissolved`,
          context: directorLabel
            ? `Directed by ${directorLabel} who is also director of ${rootNode.label}${lifespanMonths > 0 ? `. Company lasted ${lifespanMonths} months` : ''}`
            : undefined,
        });
      }
    }

    // 5. Findings as anomaly events
    for (const f of inv.progress?.findings || []) {
      events.push({
        date: '', type: 'anomaly',
        severity: f.severity === 'CRITICAL' ? 'critical' : f.severity === 'HIGH' ? 'warning' : 'info',
        title: f.title, context: f.type,
      });
    }

    // Apply time window filter
    const filtered = events.filter((e) => {
      if (!e.date) return true; // anomalies without dates always included
      const t = new Date(e.date).getTime();
      return t >= windowStart && t <= windowEnd;
    });

    // Sort by date (newest first for recent relevance, anomalies at end)
    filtered.sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      if (ta && tb) return ta - tb;
      if (ta) return -1;
      return 1;
    });

    const total = filtered.length;
    const capped = filtered.slice(0, Math.min(limit, 200));

    // Key moments: target company only
    const keyMoments: any[] = [];
    const rootInc = events.find((e) => e.type === 'incorporation' && e.title.includes(rootNode.label));
    if (rootInc) keyMoments.push(rootInc);
    const rootDiss = events.find((e) => e.type === 'dissolution' && e.title.includes(rootNode.label));
    if (rootDiss) keyMoments.push(rootDiss);
    const criticals = events.filter((e) => e.severity === 'critical' && e.type === 'anomaly').slice(0, 3);
    keyMoments.push(...criticals);

    return {
      events: capped.slice((page - 1) * limit, page * limit),
      total,
      capped: total > 200,
      keyMoments: keyMoments.slice(0, 5),
      page, limit,
      targetCompany: rootNode.label,
    };
  }
}
