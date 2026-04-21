import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

/**
 * OFAC SDN list URL (CSV format — smaller, faster to parse)
 * EU consolidated sanctions list (XML)
 * UK HMT consolidated list (CSV)
 */
const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const UK_HMT_URL = 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv';
const EU_SANCTIONS_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList/content';

// In-memory sanctions cache — loaded once per process lifetime
let ofacNames: Set<string> | null = null;
let ukNames: Set<string> | null = null;
let euNames: Set<string> | null = null;
let lastLoad = 0;
const RELOAD_INTERVAL = 24 * 60 * 60 * 1000; // reload daily

/**
 * Direct Government Sanctions Screening.
 *
 * Screens entities against official government sanctions lists:
 * - US OFAC SDN (Specially Designated Nationals)
 * - UK HMT (Her Majesty's Treasury) Consolidated List
 *
 * More authoritative than OpenSanctions — these are the actual lists
 * regulators check against.
 */
@Injectable()
export class SanctionsDirectService {
  private readonly logger = new Logger(SanctionsDirectService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async screen(investigationId: string): Promise<{ matches: SanctionsMatch[]; findings: Finding[] }> {
    // Ensure lists are loaded
    await this.loadLists();

    const allNodes = await this.nodes.find({ where: { investigationId } });
    const entities = allNodes.filter((n) => n.entityType === 'person' || n.entityType === 'company');

    this.logger.log(`Direct sanctions screening: checking ${entities.length} entities against OFAC SDN + UK HMT`);

    const matches: SanctionsMatch[] = [];

    for (const node of entities) {
      const name = node.label;
      if (!name || name.length < 3) continue;

      const normalizedName = this.normalize(name);
      const nameVariants = this.generateVariants(normalizedName);

      // Check OFAC
      if (ofacNames) {
        for (const variant of nameVariants) {
          if (ofacNames.has(variant)) {
            matches.push({
              entityName: name,
              entityNodeId: node.id,
              entityId: node.entityId,
              entityType: node.entityType,
              matchedName: variant,
              source: 'OFAC_SDN',
              matchType: variant === normalizedName ? 'exact' : 'variant',
            });
            break;
          }
        }
      }

      // Check UK HMT
      if (ukNames) {
        for (const variant of nameVariants) {
          if (ukNames.has(variant)) {
            matches.push({
              entityName: name,
              entityNodeId: node.id,
              entityId: node.entityId,
              entityType: node.entityType,
              matchedName: variant,
              source: 'UK_HMT',
              matchType: variant === normalizedName ? 'exact' : 'variant',
            });
            break;
          }
        }
      }

      // Check EU Sanctions
      if (euNames) {
        for (const variant of nameVariants) {
          if (euNames.has(variant)) {
            matches.push({
              entityName: name,
              entityNodeId: node.id,
              entityId: node.entityId,
              entityType: node.entityType,
              matchedName: variant,
              source: 'EU_SANCTIONS' as any,
              matchType: variant === normalizedName ? 'exact' : 'variant',
            });
            break;
          }
        }
      }
    }

    // Generate findings
    const findings: Finding[] = [];
    for (const match of matches) {
      findings.push({
        type: 'DIRECT_SANCTIONS_HIT',
        severity: 'CRITICAL',
        confidence: match.matchType === 'exact' ? 'HIGH' : 'MEDIUM',
        title: `${match.entityName} matches ${match.source} sanctions list`,
        description: `"${match.entityName}" has a ${match.matchType} match against the ${match.source === 'OFAC_SDN' ? 'US OFAC Specially Designated Nationals' : 'UK HMT Consolidated Sanctions'} list. ` +
          `Matched entry: "${match.matchedName}". ` +
          `This is a direct match against the official government sanctions list and requires immediate compliance action.`,
        evidence: [
          `Source: ${match.source}`,
          `Matched name: ${match.matchedName}`,
          `Match type: ${match.matchType}`,
          `Entity type: ${match.entityType}`,
        ],
        affectedEntities: [match.entityId],
        recommendation: match.source === 'OFAC_SDN'
          ? 'CRITICAL: Verify this match against the full OFAC SDN entry. If confirmed, all transactions must be blocked and reported to OFAC within 10 business days. Consult legal counsel immediately.'
          : 'CRITICAL: Verify against the full UK HMT entry. If confirmed, report to the National Crime Agency (NCA) and freeze all relevant assets. Consult compliance officer immediately.',
      });

      // Update node metadata
      try {
        const matchedNode = await this.nodes.findOne({ where: { id: match.entityNodeId } });
        if (matchedNode) {
          const meta = (matchedNode.metadata || {}) as any;
          meta.sanctionsHit = {
            source: match.source,
            matchedName: match.matchedName,
            matchType: match.matchType,
            screenedAt: new Date().toISOString(),
          };
          await this.nodes.update(match.entityNodeId, { metadata: meta });
        }
      } catch {}
    }

    this.logger.log(`Direct sanctions screening complete: ${matches.length} match(es) found`);
    return { matches, findings };
  }

  /** Load OFAC SDN and UK HMT lists into memory */
  private async loadLists(): Promise<void> {
    if (ofacNames && ukNames && euNames && Date.now() - lastLoad < RELOAD_INTERVAL) return;

    this.logger.log('Loading government sanctions lists...');

    // Load OFAC SDN
    try {
      const res = await axios.get(OFAC_SDN_URL, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'User-Agent': USER_AGENT },
      });
      const names = new Set<string>();
      const lines = (res.data as string).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        // Actual CSV format: 36,"AEROCARIBBEAN AIRLINES",-0-,"CUBA",...
        // Extract the quoted name field (second field)
        const nameMatch = line.match(/^\d+,"([^"]+)"/);
        if (nameMatch) {
          const name = nameMatch[1].trim();
          if (name.length > 2 && name !== '-0-') {
            names.add(this.normalize(name));
            // Also add reversed name for "LASTNAME, FIRSTNAME" format
            if (name.includes(',')) {
              const reversed = name.split(',').map((s: string) => s.trim()).reverse().join(' ');
              names.add(this.normalize(reversed));
            }
          }
        }
      }
      ofacNames = names;
      this.logger.log(`OFAC SDN loaded: ${names.size} names`);
    } catch (e: any) {
      this.logger.warn(`OFAC SDN load failed: ${e?.message}`);
      if (!ofacNames) ofacNames = new Set();
    }

    // Load UK HMT
    try {
      const res = await axios.get(UK_HMT_URL, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'User-Agent': USER_AGENT },
      });
      const names = new Set<string>();
      const lines = (res.data as string).split('\n');
      for (const line of lines) {
        // UK HMT CSV has name fields at various positions
        const parts = line.split(',');
        // Try to extract Name6 (full name) or Name1 + Name2
        for (let i = 0; i < Math.min(parts.length, 10); i++) {
          const val = (parts[i] || '').replace(/"/g, '').trim();
          if (val.length > 3 && val.length < 100 && !/^\d+$/.test(val) && !/^(individual|entity|group|name)/i.test(val)) {
            names.add(this.normalize(val));
          }
        }
      }
      ukNames = names;
      this.logger.log(`UK HMT loaded: ${names.size} names`);
    } catch (e: any) {
      this.logger.warn(`UK HMT load failed: ${e?.message}`);
      if (!ukNames) ukNames = new Set();
    }

    // Load EU Sanctions
    try {
      const res = await axios.get(EU_SANCTIONS_URL, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'User-Agent': USER_AGENT },
      });
      const names = new Set<string>();
      const lines = (res.data as string).split('\n');
      for (const line of lines) {
        // EU CSV has name fields — extract quoted values that look like names
        const quotedValues = line.match(/"([^"]{3,80})"/g) || [];
        for (const qv of quotedValues) {
          const val = qv.replace(/"/g, '').trim();
          if (val.length > 3 && val.length < 80 && !/^\d+$/.test(val) && !/^(entity|individual|programme|regulation)/i.test(val)) {
            names.add(this.normalize(val));
            if (val.includes(',')) {
              const reversed = val.split(',').map((s: string) => s.trim()).reverse().join(' ');
              names.add(this.normalize(reversed));
            }
          }
        }
      }
      euNames = names;
      this.logger.log(`EU sanctions loaded: ${names.size} names`);
    } catch (e: any) {
      this.logger.warn(`EU sanctions load failed: ${e?.message}`);
      if (!euNames) euNames = new Set();
    }

    lastLoad = Date.now();
  }

  /** Normalize name for matching */
  private normalize(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Generate name variants for fuzzy matching */
  private generateVariants(name: string): string[] {
    const variants = [name];

    // Without common suffixes
    const stripped = name.replace(/\b(inc|corp|ltd|plc|llc|co|gmbh|sa|ag|nv|bv|limited|corporation)\b/g, '').replace(/\s+/g, ' ').trim();
    if (stripped !== name && stripped.length > 2) variants.push(stripped);

    // Without middle initials
    const noMiddle = name.replace(/\b[a-z]\b/g, '').replace(/\s+/g, ' ').trim();
    if (noMiddle !== name && noMiddle.length > 2) variants.push(noMiddle);

    return variants;
  }
}

export interface SanctionsMatch {
  entityName: string;
  entityNodeId: string;
  entityId: string;
  entityType: string;
  matchedName: string;
  source: 'OFAC_SDN' | 'UK_HMT' | 'EU_SANCTIONS';
  matchType: 'exact' | 'variant';
}
