import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EntityMatch, MatchedSource } from './entities/entity-match.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { OpenSanctionsService } from '../open-sanctions/open-sanctions.service';
import { OffshoreLeaksService } from '../offshore-leaks/offshore-leaks.service';
import { jaroWinkler, metaphone, normalizeName } from './algorithms';

export interface MatchCandidate {
  id: string;
  names: string[];
  birthYear?: number;
  nationality?: string;
}

export interface ScoreResult {
  score: number;
  reasons: Record<string, any>;
}

export interface ResolutionEvents {
  onEntityMatched?: (match: EntityMatch) => void;
  onProgress?: (p: { processed: number; total: number; matches: number }) => void;
}

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    @InjectRepository(EntityMatch) private readonly matches: Repository<EntityMatch>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    private readonly sanctions: OpenSanctionsService,
    private readonly offshore: OffshoreLeaksService,
  ) {}

  /**
   * Score a source entity against a candidate. Weights:
   *   exact name = 40, phonetic = 20, jaro-winkler > 0.85 = 15
   *   DOB year = 30, nationality = 10
   * Threshold: >75 match, 50-75 possible, <50 reject.
   */
  score(source: MatchCandidate, candidate: MatchCandidate): ScoreResult {
    const reasons: Record<string, any> = {};
    let score = 0;

    const sourceNames = source.names.map(normalizeName).filter(Boolean);
    const candNames = candidate.names.map(normalizeName).filter(Boolean);

    let bestExact = false;
    let bestPhonetic = false;
    let bestJW = 0;
    for (const sn of sourceNames) {
      for (const cn of candNames) {
        if (sn === cn) bestExact = true;
        if (metaphone(sn) && metaphone(sn) === metaphone(cn)) bestPhonetic = true;
        const jw = jaroWinkler(sn, cn);
        if (jw > bestJW) bestJW = jw;
      }
    }

    if (bestExact) { score += 40; reasons.exactName = true; }
    if (bestPhonetic) { score += 20; reasons.phoneticMatch = true; }
    if (bestJW > 0.85) { score += 15; reasons.jaroWinkler = bestJW.toFixed(3); }

    if (source.birthYear && candidate.birthYear && source.birthYear === candidate.birthYear) {
      score += 30;
      reasons.dobMatch = source.birthYear;
    }

    if (
      source.nationality &&
      candidate.nationality &&
      source.nationality.toLowerCase() === candidate.nationality.toLowerCase()
    ) {
      score += 10;
      reasons.nationality = source.nationality;
    }

    return { score: Math.min(100, score), reasons };
  }

  classify(score: number): 'match' | 'possible' | 'none' {
    if (score > 75) return 'match';
    if (score >= 50) return 'possible';
    return 'none';
  }

  /**
   * Quick screen: check a name directly against OpenSanctions + ICIJ without
   * creating an investigation. Returns top-scoring matches.
   */
  async quickScreen(name: string, type: 'person' | 'company' = 'person'): Promise<any[]> {
    const source: MatchCandidate = { id: 'screen', names: [name] };
    const results: any[] = [];

    // OpenSanctions
    const sanctionHits = await this.sanctions.searchByName(name);
    for (const h of sanctionHits.slice(0, 10)) {
      const ent = h.entity;
      const names: string[] = [];
      try {
        const props = typeof ent.properties === 'string' ? JSON.parse(ent.properties) : ent.properties;
        if (props?.name) names.push(...(Array.isArray(props.name) ? props.name : [props.name]));
      } catch {}
      if (names.length === 0 && ent.names?.length) names.push(...ent.names);
      const candidate: MatchCandidate = { id: ent.id, names };
      const { score, reasons } = this.score(source, candidate);
      if (score >= 50) {
        results.push({
          source: 'opensanctions',
          matchedName: names[0],
          matchedId: ent.id,
          confidence: score,
          reasons,
          schema: ent.schemaType,
        });
      }
    }

    // ICIJ
    const offshoreHits = type === 'person'
      ? await this.offshore.searchOfficersByName(name)
      : await this.offshore.searchEntitiesByName(name);
    for (const h of offshoreHits.slice(0, 10)) {
      const candidate: MatchCandidate = { id: String(h.id), names: [h.name] };
      const { score, reasons } = this.score(source, candidate);
      if (score >= 50) {
        results.push({
          source: 'icij_offshore',
          matchedName: h.name,
          matchedId: h.id,
          confidence: score,
          reasons,
        });
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
  }

  async resolveInvestigation(
    investigationId: string,
    events: ResolutionEvents = {},
  ): Promise<{ processed: number; matches: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });

    // FIX 1: Skip unmatchable entities - addresses never match sanctions,
    // numeric-only names (e.g. "00128058 LIMITED") and short names (<3 chars)
    // won't produce meaningful fuzzy matches
    const isScreenable = (label: string) => {
      if (!label || label.length < 3) return false;
      // Skip purely numeric names like "00128058 LIMITED"
      if (/^\d+\s*(LIMITED|LTD|PLC)?$/i.test(label.trim())) return false;
      return true;
    };

    const personNodes = nodes.filter((n) => n.entityType === 'person' && isScreenable(n.label));
    const companyNodes = nodes.filter((n) => n.entityType === 'company' && isScreenable(n.label) && !n.metadata?.isFormationAgent);

    let totalMatches = 0;
    const total = personNodes.length + companyNodes.length;
    this.logger.log(`Resolution for ${investigationId}: screening ${total} of ${nodes.length} entities (${nodes.length - total} skipped as unmatchable)`);

    // FIX 2: Batch fuzzy matching - collect all names, run batch queries,
    // then iterate results instead of one query per entity
    const personNames = personNodes.map((n) => n.label);
    const companyNames = companyNodes.map((n) => n.label);

    // Batch sanctions search (persons only)
    events.onProgress?.({ processed: 0, total, matches: 0 });
    this.logger.log(`Batch sanctions search for ${personNames.length} persons...`);
    const sanctionsBatch = await this.sanctions.batchSearchByNames(personNames);
    this.logger.log(`Batch sanctions search complete: ${sanctionsBatch.size} names with hits`);

    // Batch offshore officers (persons)
    this.logger.log(`Batch offshore officers search for ${personNames.length} persons...`);
    const offshoreOfficersBatch = await this.offshore.batchSearch('offshore_officers', personNames);
    this.logger.log(`Batch offshore officers complete: ${offshoreOfficersBatch.size} names with hits`);

    // Batch offshore entities (companies)
    this.logger.log(`Batch offshore entities search for ${companyNames.length} companies...`);
    const offshoreEntitiesBatch = await this.offshore.batchSearch('offshore_entities', companyNames);
    this.logger.log(`Batch offshore entities complete: ${offshoreEntitiesBatch.size} names with hits`);

    // Now iterate results and score
    let processed = 0;
    for (const node of personNodes) {
      const source: MatchCandidate = {
        id: node.entityId,
        names: [node.label],
        birthYear: node.metadata?.dateOfBirth?.year,
        nationality: node.metadata?.nationality,
      };
      const nameKey = node.label.toLowerCase().trim();

      // Sanctions hits
      for (const hit of sanctionsBatch.get(nameKey) || []) {
        const cand: MatchCandidate = {
          id: hit.entity.id,
          names: hit.entity.names || [],
          birthYear: parseBirthYear(hit.entity.birthDates?.[0]),
          nationality: hit.entity.nationalities?.[0],
        };
        const { score, reasons } = this.score(source, cand);
        if (this.classify(score) !== 'none') {
          await this.persistMatch(investigationId, 'person', node.entityId, 'opensanctions', hit.entity.id, score, {
            ...reasons, trigramSimilarity: hit.similarity, matchedName: hit.entity.names?.[0], topics: hit.entity.topics,
          }, events);
          totalMatches++;
        }
      }

      // Offshore officer hits
      for (const hit of offshoreOfficersBatch.get(nameKey) || []) {
        const cand: MatchCandidate = { id: hit.entity.id, names: [hit.entity.name], nationality: hit.entity.country };
        const { score, reasons } = this.score(source, cand);
        if (this.classify(score) !== 'none') {
          await this.persistMatch(investigationId, 'person', node.entityId, 'offshore_leaks', hit.entity.id, score, {
            ...reasons, matchedName: hit.entity.name, sourceid: hit.entity.sourceid,
          }, events);
          totalMatches++;
        }
      }

      processed++;
      if (processed % 200 === 0 || processed === personNodes.length) {
        events.onProgress?.({ processed, total, matches: totalMatches });
      }
    }

    for (const node of companyNodes) {
      const source: MatchCandidate = { id: node.entityId, names: [node.label] };
      const nameKey = node.label.toLowerCase().trim();

      for (const hit of offshoreEntitiesBatch.get(nameKey) || []) {
        const cand: MatchCandidate = { id: hit.entity.id, names: [hit.entity.name] };
        const { score, reasons } = this.score(source, cand);
        if (this.classify(score) !== 'none') {
          await this.persistMatch(investigationId, 'company', node.entityId, 'offshore_leaks', hit.entity.id, score, {
            ...reasons, matchedName: hit.entity.name, jurisdiction: hit.entity.jurisdiction, sourceid: hit.entity.sourceid,
          }, events);
          totalMatches++;
        }
      }
      processed++;
      if (processed % 200 === 0 || processed === total) {
        events.onProgress?.({ processed, total, matches: totalMatches });
      }
    }

    this.logger.log(`Resolution for ${investigationId}: ${processed} nodes, ${totalMatches} matches`);
    return { processed, matches: totalMatches };
  }

  private async persistMatch(
    investigationId: string,
    sourceType: string,
    sourceId: string,
    matchedSource: MatchedSource,
    matchedId: string,
    score: number,
    reasons: Record<string, any>,
    events: ResolutionEvents,
  ): Promise<void> {
    const match = await this.matches.save(
      this.matches.create({
        investigationId,
        sourceEntityType: sourceType,
        sourceEntityId: sourceId,
        matchedSource,
        matchedEntityId: matchedId,
        confidenceScore: score,
        matchReasons: reasons,
      }),
    );
    events.onEntityMatched?.(match);
  }
}

function parseBirthYear(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : undefined;
}
