import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export type CompanyProfile =
  | 'LARGE_PUBLIC'
  | 'ESTABLISHED_PRIVATE'
  | 'SMALL_PRIVATE'
  | 'MICRO_ENTITY'
  | 'NEWLY_FORMED'
  | 'DISSOLVED'
  | 'FOREIGN';

const NOW = () => new Date();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class CompanyClassifierService {
  private readonly logger = new Logger(CompanyClassifierService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async classifyAll(investigationId: string): Promise<{ classified: number; byProfile: Record<string, number> }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });

    // Officer counts per company (from director/appointment edges)
    const officerCount = new Map<string, number>();
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      // increment whichever side is the company
      // we don't have type info on the edge so increment both — the non-company side will be discarded
      officerCount.set(e.sourceNodeId, (officerCount.get(e.sourceNodeId) || 0) + 1);
      officerCount.set(e.targetNodeId, (officerCount.get(e.targetNodeId) || 0) + 1);
    }

    const companies = nodes.filter((n) => n.entityType === 'company');
    const byProfile: Record<string, number> = {};

    for (const c of companies) {
      const profile = this.classify(c, officerCount.get(c.id) || 0);
      byProfile[profile] = (byProfile[profile] || 0) + 1;
      c.metadata = { ...(c.metadata || {}), companyProfile: profile };
      await this.nodes.save(c);
    }

    this.logger.log(`Classified ${companies.length} companies in ${investigationId}: ${JSON.stringify(byProfile)}`);
    return { classified: companies.length, byProfile };
  }

  classify(node: GraphNode, officerCount: number): CompanyProfile {
    const meta = node.metadata || {};
    const status = (meta.status || '').toLowerCase();
    const type = (meta.companyType || '').toLowerCase();
    const accountsType = (meta.accountsType || '').toLowerCase();
    const incDate = meta.incorporationDate;
    const ageYears = incDate
      ? (NOW().getTime() - new Date(incDate).getTime()) / YEAR_MS
      : null;

    // DISSOLVED first — overrides everything
    if (/dissolved|liquidat|struck/.test(status)) return 'DISSOLVED';

    // FOREIGN
    if (/oversea|foreign/.test(type) || /(oversea|foreign)/i.test(meta.jurisdiction || '')) return 'FOREIGN';

    // LARGE_PUBLIC: PLC, or ltd 15+ years with 20+ officers
    const isPlc = type === 'plc' || type === 'public-limited-company' || type.includes('public');
    if (isPlc) return 'LARGE_PUBLIC';
    if (type === 'ltd' && ageYears && ageYears >= 15 && officerCount >= 20) return 'LARGE_PUBLIC';

    // NEWLY_FORMED: under 3 years
    if (ageYears !== null && ageYears < 3) return 'NEWLY_FORMED';

    // MICRO_ENTITY: filing micro or dormant accounts
    if (/(micro|dormant)/i.test(accountsType)) return 'MICRO_ENTITY';

    // ESTABLISHED_PRIVATE: 10+ years, full/medium accounts
    if (ageYears !== null && ageYears >= 10) {
      if (/(full|medium|group)/i.test(accountsType) || !accountsType) return 'ESTABLISHED_PRIVATE';
    }

    // SMALL_PRIVATE: 3-10 years, small/no accounts
    if (ageYears !== null && ageYears >= 3 && ageYears < 10) return 'SMALL_PRIVATE';

    // Fallback for older companies without account type info
    if (ageYears !== null && ageYears >= 10) return 'ESTABLISHED_PRIVATE';

    return 'SMALL_PRIVATE';
  }
}
