import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';

export type JurisdictionRisk = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

interface JurisdictionEntry {
  risk: JurisdictionRisk;
  /** Display name. */
  name: string;
  /** Lowercase aliases used during lookup. */
  aliases: string[];
}

const TABLE: JurisdictionEntry[] = [
  // ---- HIGH RISK (offshore secrecy / opaque ownership / weak enforcement) ----
  { risk: 'HIGH', name: 'British Virgin Islands', aliases: ['british virgin islands', 'bvi', 'virgin islands'] },
  { risk: 'HIGH', name: 'Cayman Islands', aliases: ['cayman islands', 'cayman'] },
  { risk: 'HIGH', name: 'Panama', aliases: ['panama'] },
  { risk: 'HIGH', name: 'Seychelles', aliases: ['seychelles'] },
  { risk: 'HIGH', name: 'Marshall Islands', aliases: ['marshall islands', 'marshall'] },
  { risk: 'HIGH', name: 'Belize', aliases: ['belize'] },
  // ---- MEDIUM RISK (well-regulated but historically used for secrecy / treaty shopping) ----
  { risk: 'MEDIUM', name: 'Cyprus', aliases: ['cyprus'] },
  { risk: 'MEDIUM', name: 'Malta', aliases: ['malta'] },
  { risk: 'MEDIUM', name: 'Luxembourg', aliases: ['luxembourg'] },
  { risk: 'MEDIUM', name: 'Jersey', aliases: ['jersey'] },
  { risk: 'MEDIUM', name: 'Guernsey', aliases: ['guernsey'] },
  { risk: 'MEDIUM', name: 'Isle of Man', aliases: ['isle of man'] },
  { risk: 'MEDIUM', name: 'Gibraltar', aliases: ['gibraltar'] },
  { risk: 'MEDIUM', name: 'Mauritius', aliases: ['mauritius'] },
  { risk: 'MEDIUM', name: 'Bahamas', aliases: ['bahamas'] },
  { risk: 'MEDIUM', name: 'Bermuda', aliases: ['bermuda'] },
  // ---- LOW RISK (transparent registries, robust enforcement) ----
  { risk: 'LOW', name: 'United Kingdom', aliases: ['united kingdom', 'uk', 'great britain', 'england', 'wales', 'scotland', 'northern ireland', 'gb'] },
  { risk: 'LOW', name: 'United States', aliases: ['united states', 'usa', 'us', 'america'] },
  { risk: 'LOW', name: 'Germany', aliases: ['germany', 'deutschland'] },
  { risk: 'LOW', name: 'France', aliases: ['france'] },
  { risk: 'LOW', name: 'Australia', aliases: ['australia'] },
  { risk: 'LOW', name: 'Canada', aliases: ['canada'] },
];

export interface JurisdictionAssessment {
  raw: string;
  matched?: string;
  risk: JurisdictionRisk;
}

export function classifyJurisdiction(raw: string | undefined | null): JurisdictionAssessment {
  if (!raw) return { raw: '', risk: 'UNKNOWN' };
  const norm = raw.toString().trim().toLowerCase();
  if (!norm) return { raw: '', risk: 'UNKNOWN' };
  for (const e of TABLE) {
    for (const alias of e.aliases) {
      if (norm.includes(alias)) {
        return { raw, matched: e.name, risk: e.risk };
      }
    }
  }
  return { raw, risk: 'UNKNOWN' };
}

@Injectable()
export class JurisdictionRiskService {
  private readonly logger = new Logger(JurisdictionRiskService.name);

  constructor(@InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>) {}

  /**
   * Tag every company and address node with a jurisdiction risk assessment.
   * Also walks the UBO chains stored on the investigation progress and boosts
   * any chain that crosses a HIGH-risk jurisdiction (sets `crossesHighRisk` and
   * appends 'OFFSHORE' to its flags if not already present).
   */
  async tagAll(investigationId: string, uboChains?: any[]): Promise<{
    tagged: number;
    high: number;
    medium: number;
    chainsBoosted: number;
  }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    let tagged = 0;
    let high = 0;
    let medium = 0;

    for (const n of nodes) {
      let raw: string | undefined;
      if (n.entityType === 'company') {
        raw = n.metadata?.jurisdiction;
      } else if (n.entityType === 'address') {
        // Try to extract a country from the label tail, otherwise from metadata.country
        raw = n.metadata?.country || (n.label?.split(',').pop() || '').trim();
      }
      const assessment = classifyJurisdiction(raw);
      if (assessment.risk === 'UNKNOWN' && !raw) continue;

      const meta = { ...(n.metadata || {}), jurisdictionRisk: assessment as any };
      n.metadata = meta;
      await this.nodes.update(n.id, { metadata: meta as any });
      tagged++;
      if (assessment.risk === 'HIGH') high++;
      else if (assessment.risk === 'MEDIUM') medium++;
    }

    // Boost UBO chains crossing high-risk jurisdictions
    let chainsBoosted = 0;
    if (uboChains) {
      for (const chain of uboChains) {
        const crosses = (chain.path || []).some((node: any) =>
          classifyJurisdiction(node.jurisdiction).risk === 'HIGH',
        );
        if (crosses) {
          chain.crossesHighRisk = true;
          chain.flags = chain.flags || [];
          if (!chain.flags.includes('OFFSHORE')) chain.flags.push('OFFSHORE');
          chainsBoosted++;
        }
      }
    }

    this.logger.log(
      `JurisdictionRisk ${investigationId}: tagged=${tagged} high=${high} medium=${medium} chainsBoosted=${chainsBoosted}`,
    );
    return { tagged, high, medium, chainsBoosted };
  }
}
