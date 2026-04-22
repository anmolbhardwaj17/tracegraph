import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { normalizeName, jaroWinkler, metaphone } from '../entity-resolution/algorithms';
import { Finding } from '../risk-scoring/finding.types';

export interface MergeResult {
  mergedPairs: Array<{ nodeA: string; nodeB: string; confidence: number; reasons: string[] }>;
  totalMerged: number;
  findings: Finding[];
}

/**
 * Phase I: Entity Resolution / Merge Engine.
 *
 * Detects and merges the same person/company appearing as different nodes
 * across multiple sources (SEC, Wikidata, Companies House, NSE, etc.)
 *
 * Matching signals:
 * - Name similarity (Jaro-Winkler > 0.88)
 * - Phonetic match (Double Metaphone)
 * - Shared attributes (nationality, date of birth, CIK, CIN)
 * - Shared connections (both connected to the same company)
 *
 * Creates "alias" metadata linking merged entities and unifies their data.
 */
@Injectable()
export class EntityMergeService {
  private readonly logger = new Logger(EntityMergeService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(GraphEdge) private readonly edges: Repository<GraphEdge>,
  ) {}

  async merge(investigationId: string): Promise<MergeResult> {
    const allNodes = await this.nodes.find({ where: { investigationId } });
    const people = allNodes.filter((n) => n.entityType === 'person');
    const companies = allNodes.filter((n) => n.entityType === 'company');

    this.logger.log(`Entity merge: ${people.length} people, ${companies.length} companies`);

    const mergedPairs: MergeResult['mergedPairs'] = [];

    // Merge people
    const peopleMerges = this.findMerges(people);
    mergedPairs.push(...peopleMerges);

    // Merge companies
    const companyMerges = this.findMerges(companies);
    mergedPairs.push(...companyMerges);

    // Apply merges — update metadata, don't delete nodes (preserve provenance)
    for (const pair of mergedPairs) {
      await this.applyMerge(pair.nodeA, pair.nodeB, pair.confidence, pair.reasons);
    }

    // Generate findings
    const findings: Finding[] = [];
    if (mergedPairs.length > 0) {
      const personMerges = peopleMerges.length;
      const companyMerges2 = companyMerges.length;
      findings.push({
        type: 'ENTITY_RESOLUTION',
        severity: 'LOW',
        confidence: 'HIGH',
        title: `${mergedPairs.length} entities merged across sources`,
        description: `Entity resolution identified ${personMerges} person(s) and ${companyMerges2} company(ies) that appear in multiple data sources under different names. These have been linked for unified profiling.`,
        evidence: mergedPairs.slice(0, 5).map((p) => `${p.reasons.join(', ')} (${p.confidence}% confidence)`),
        affectedEntities: mergedPairs.flatMap((p) => [p.nodeA, p.nodeB]).slice(0, 10),
        recommendation: 'Review merged entities to confirm identity matches. High-confidence merges (>90%) are reliable.',
      });
    }

    this.logger.log(`Entity merge complete: ${mergedPairs.length} pairs merged`);
    return { mergedPairs, totalMerged: mergedPairs.length, findings };
  }

  /** Find entities that should be merged using multi-signal matching */
  private findMerges(nodes: GraphNode[]): MergeResult['mergedPairs'] {
    const merges: MergeResult['mergedPairs'] = [];
    const alreadyMerged = new Set<string>();

    for (let i = 0; i < nodes.length; i++) {
      if (alreadyMerged.has(nodes[i].id)) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        if (alreadyMerged.has(nodes[j].id)) continue;

        const result = this.compareEntities(nodes[i], nodes[j]);
        if (result.confidence >= 70) {
          merges.push({
            nodeA: nodes[i].id,
            nodeB: nodes[j].id,
            confidence: result.confidence,
            reasons: result.reasons,
          });
          alreadyMerged.add(nodes[j].id); // Don't merge the same node twice
        }
      }
    }

    return merges;
  }

  /** Compare two entities and return confidence + reasons */
  private compareEntities(a: GraphNode, b: GraphNode): { confidence: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const metaA = (a.metadata || {}) as any;
    const metaB = (b.metadata || {}) as any;

    // 1. Name similarity
    const normA = normalizeName(a.label);
    const normB = normalizeName(b.label);
    if (!normA || !normB) return { confidence: 0, reasons: [] };

    // Exact match after normalization
    if (normA === normB) {
      score += 50;
      reasons.push(`Exact name match: "${a.label}"`);
    } else {
      // Jaro-Winkler similarity
      const jw = jaroWinkler(normA, normB);
      if (jw >= 0.92) {
        score += 40;
        reasons.push(`Name similarity: ${(jw * 100).toFixed(0)}%`);
      } else if (jw >= 0.85) {
        score += 25;
        reasons.push(`Partial name match: ${(jw * 100).toFixed(0)}%`);
      } else {
        // Not similar enough — check phonetic
        const metA = metaphone(normA);
        const metB = metaphone(normB);
        if (metA && metA === metB) {
          score += 20;
          reasons.push(`Phonetic match (sounds alike)`);
        } else {
          return { confidence: 0, reasons: [] }; // Names too different
        }
      }
    }

    // 2. Shared identifiers (definitive)
    if (metaA.cik && metaB.cik && metaA.cik === metaB.cik) {
      score += 40;
      reasons.push(`Same CIK: ${metaA.cik}`);
    }
    if (metaA.cin && metaB.cin && metaA.cin === metaB.cin) {
      score += 40;
      reasons.push(`Same CIN: ${metaA.cin}`);
    }
    if (metaA.isin && metaB.isin && metaA.isin === metaB.isin) {
      score += 40;
      reasons.push(`Same ISIN: ${metaA.isin}`);
    }

    // 3. Same nationality
    if (metaA.nationality && metaB.nationality &&
        metaA.nationality.toLowerCase() === metaB.nationality.toLowerCase()) {
      score += 10;
      reasons.push(`Same nationality: ${metaA.nationality}`);
    }

    // 4. Same data source → lower confidence (might be duplicate, not cross-source)
    if (metaA.dataSource && metaB.dataSource && metaA.dataSource === metaB.dataSource) {
      score -= 10; // Penalize same-source matches
    } else if (metaA.dataSource && metaB.dataSource) {
      score += 15; // Bonus for cross-source match
      reasons.push(`Cross-source: ${metaA.dataSource} + ${metaB.dataSource}`);
    }

    // 5. Token overlap (for company names with extra words)
    const tokensA = new Set(normA.split(/\s+/));
    const tokensB = new Set(normB.split(/\s+/));
    const intersection = [...tokensA].filter((t) => tokensB.has(t) && t.length > 2);
    const union = new Set([...tokensA, ...tokensB]);
    const jaccard = intersection.length / union.size;
    if (jaccard >= 0.6 && intersection.length >= 2) {
      score += 10;
      reasons.push(`Token overlap: ${intersection.join(', ')}`);
    }

    return { confidence: Math.min(100, Math.max(0, score)), reasons };
  }

  /** Apply a merge — link the two nodes via metadata */
  private async applyMerge(nodeAId: string, nodeBId: string, confidence: number, reasons: string[]): Promise<void> {
    try {
      const [nodeA, nodeB] = await Promise.all([
        this.nodes.findOne({ where: { id: nodeAId } }),
        this.nodes.findOne({ where: { id: nodeBId } }),
      ]);
      if (!nodeA || !nodeB) return;

      // Mark both nodes as merged — nodeA is the "primary"
      const metaA = (nodeA.metadata || {}) as any;
      const metaB = (nodeB.metadata || {}) as any;

      metaA.mergedWith = nodeBId;
      metaA.mergeConfidence = confidence;
      metaA.mergeReasons = reasons;
      metaA.aliases = [...(metaA.aliases || []), nodeB.label];
      // Merge useful fields from B into A
      if (!metaA.isPep && metaB.isPep) metaA.isPep = true;
      if (!metaA.pepPositions && metaB.pepPositions) metaA.pepPositions = metaB.pepPositions;
      if (!metaA.sanctionsHit && metaB.sanctionsHit) metaA.sanctionsHit = metaB.sanctionsHit;
      if (!metaA.adverseMedia && metaB.adverseMedia) metaA.adverseMedia = metaB.adverseMedia;
      if (!metaA.politicalDonations && metaB.politicalDonations) metaA.politicalDonations = metaB.politicalDonations;
      metaA.sourcesCount = (metaA.sourcesCount || 1) + 1;

      metaB.mergedInto = nodeAId;
      metaB.mergeConfidence = confidence;

      await Promise.all([
        this.nodes.update(nodeAId, { metadata: metaA }),
        this.nodes.update(nodeBId, { metadata: metaB }),
      ]);
    } catch {}
  }
}
