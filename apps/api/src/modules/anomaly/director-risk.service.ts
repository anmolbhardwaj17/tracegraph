import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

export type DirectorRisk = 'PROFESSIONAL_DIRECTOR' | 'SERIAL_ENTREPRENEUR' | 'NOMINEE_PATTERN' | 'FORMATION_AGENT' | 'NORMAL';

export interface DirectorProfile {
  risk: DirectorRisk;
  totalAppointments: number;
  active: number;
  dissolved: number;
  dissolvedRatio: number;
  averageLifespanYears: number | null;
  uniqueAddresses: number;
  uniqueSics: number;
  microOnly: boolean;
  reasons: string[];
}

const NOW = () => new Date();
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class DirectorRiskService {
  private readonly logger = new Logger(DirectorRiskService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async profileAll(investigationId: string): Promise<{ profiled: number; flagged: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const edges = await this.edges.find({ where: { investigationId } });
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    // Build person → companies map
    const personDirectorships = new Map<string, GraphNode[]>();
    for (const e of edges) {
      if (e.relationshipType !== 'director' && e.relationshipType !== 'appointment') continue;
      const src = byId.get(e.sourceNodeId);
      const tgt = byId.get(e.targetNodeId);
      if (!src || !tgt) continue;
      const person = src.entityType === 'person' ? src : tgt.entityType === 'person' ? tgt : null;
      const company = src.entityType === 'company' ? src : tgt.entityType === 'company' ? tgt : null;
      if (!person || !company) continue;
      const list = personDirectorships.get(person.id) || [];
      list.push(company);
      personDirectorships.set(person.id, list);
    }

    // Build company → address node lookup
    const companyAddress = new Map<string, string>();
    for (const e of edges) {
      if (e.relationshipType !== 'address') continue;
      const src = byId.get(e.sourceNodeId);
      const tgt = byId.get(e.targetNodeId);
      if (!src || !tgt) continue;
      const company = src.entityType === 'company' ? src : tgt.entityType === 'company' ? tgt : null;
      const address = src.entityType === 'address' ? src : tgt.entityType === 'address' ? tgt : null;
      if (company && address) companyAddress.set(company.id, address.id);
    }

    let flagged = 0;
    let profiled = 0;
    for (const [personId, portfolio] of personDirectorships.entries()) {
      const person = byId.get(personId);
      if (!person) continue;
      const profile = this.profileDirector(portfolio, companyAddress);
      person.metadata = { ...(person.metadata || {}), directorProfile: profile };
      if (profile.risk === 'NOMINEE_PATTERN' || profile.risk === 'FORMATION_AGENT') flagged++;
      await this.nodes.save(person);
      profiled++;
    }

    this.logger.log(`Profiled ${profiled} directors (${flagged} flagged as nominee/formation)`);
    return { profiled, flagged };
  }

  profileDirector(portfolio: GraphNode[], companyAddress: Map<string, string>): DirectorProfile {
    const reasons: string[] = [];
    const total = portfolio.length;
    const active = portfolio.filter((c) => /active/i.test(c.metadata?.status || '')).length;
    const dissolved = portfolio.filter((c) => /dissolved|liquidat|struck/i.test(c.metadata?.status || '')).length;
    const dissolvedRatio = total > 0 ? dissolved / total : 0;

    // Lifespans
    const lifespans: number[] = [];
    for (const c of portfolio) {
      const inc = c.metadata?.incorporationDate;
      const diss = c.metadata?.dissolutionDate;
      if (inc && diss) {
        lifespans.push((new Date(diss).getTime() - new Date(inc).getTime()) / YEAR_MS);
      }
    }
    const avgLifespan = lifespans.length > 0 ? lifespans.reduce((a, b) => a + b, 0) / lifespans.length : null;

    // Unique addresses
    const addrSet = new Set<string>();
    for (const c of portfolio) {
      const a = companyAddress.get(c.id);
      if (a) addrSet.add(a);
    }
    const uniqueAddresses = addrSet.size;

    // SIC codes
    const sicSet = new Set<string>();
    for (const c of portfolio) {
      for (const s of c.metadata?.sicCodes || []) sicSet.add(s);
    }
    const uniqueSics = sicSet.size;

    // Micro/dormant only
    const microOnly =
      total > 0 &&
      portfolio.every((c) => /(micro|dormant)/i.test(c.metadata?.accountsType || ''));

    // Whether companies are mostly PLC/established (a "professional director" indicator)
    const onPlcOrEstablished = portfolio.filter(
      (c) => c.metadata?.companyProfile === 'LARGE_PUBLIC' || c.metadata?.companyProfile === 'ESTABLISHED_PRIVATE',
    ).length;

    // ---- Classify ----
    let risk: DirectorRisk = 'NORMAL';

    if (total >= 30 && microOnly && uniqueAddresses <= 3) {
      risk = 'FORMATION_AGENT';
      reasons.push(`${total} appointments, all micro/dormant, only ${uniqueAddresses} address(es)`);
    } else if (total >= 15 && microOnly && uniqueAddresses <= 5) {
      risk = 'NOMINEE_PATTERN';
      reasons.push(`${total} appointments, all micro/dormant, ${uniqueAddresses} addresses`);
    } else if (total >= 5 && total <= 15 && onPlcOrEstablished >= total / 2) {
      risk = 'PROFESSIONAL_DIRECTOR';
      reasons.push(`${total} appointments, mostly on established/public companies`);
    } else if (total >= 3 && total <= 8 && uniqueSics >= 2 && !microOnly) {
      risk = 'SERIAL_ENTREPRENEUR';
      reasons.push(`${total} appointments across ${uniqueSics} different industries`);
    } else if (avgLifespan !== null && avgLifespan < 2 && dissolvedRatio > 0.5 && total >= 5) {
      risk = 'NOMINEE_PATTERN';
      reasons.push(`Short avg lifespan (${avgLifespan.toFixed(1)}y), ${(dissolvedRatio * 100).toFixed(0)}% dissolved`);
    }

    return {
      risk,
      totalAppointments: total,
      active,
      dissolved,
      dissolvedRatio,
      averageLifespanYears: avgLifespan,
      uniqueAddresses,
      uniqueSics,
      microOnly,
      reasons,
    };
  }
}
