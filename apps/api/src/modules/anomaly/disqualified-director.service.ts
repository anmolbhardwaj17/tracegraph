import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';

const SEARCH_CAP = 60; // Cap CH calls per investigation
const FUZZY_THRESHOLD = 75;

export interface DisqualificationDetail {
  /** CH disqualified-officers natural-person id, e.g. /disqualified-officers/natural/{id} */
  officerId: string;
  matchedName: string;
  fromDate?: string;
  toDate?: string;
  reason?: string;
  caseRef?: string;
  isUndertaking?: boolean;
  /** Address strings if returned. */
  addressLine?: string;
  /** Our fuzzy confidence, 0-100. */
  confidence: number;
}

export interface DisqualifiedDirectorMatch {
  personNodeId: string;
  personName: string;
  matches: DisqualificationDetail[];
}

/** Lightweight name normaliser for fuzzy comparison. */
function normalize(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|sir|dame|lord|lady|prof|professor)\b\.?/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(name: string): string[] {
  return normalize(name).split(' ').filter(Boolean);
}

/**
 * Token-based fuzzy match.
 *  - 100 if every token of `a` matches some token of `b` and vice versa
 *  - Penalises missing or extra tokens
 *  - Allows last-name-first reordering automatically (set semantics)
 */
function tokenSetSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  // Dice score (heavier weight on intersection)
  return Math.round((2 * intersection / (ta.size + tb.size)) * 100);
}

@Injectable()
export class DisqualifiedDirectorService {
  private readonly logger = new Logger(DisqualifiedDirectorService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    private readonly ch: CompaniesHouseService,
  ) {}

  /**
   * For every person in the investigation graph (capped at SEARCH_CAP),
   * search the CH disqualified-officers index. Fuzzy-match returned names
   * against the person; if confidence ≥ threshold, persist match details
   * onto node.metadata.disqualifications.
   */
  async checkAll(investigationId: string): Promise<DisqualifiedDirectorMatch[]> {
    const persons = await this.nodes.find({
      where: { investigationId, entityType: 'person' },
    });
    if (persons.length === 0) return [];

    // Sort by degree-ish heuristic — for now just label length is a poor stand-in.
    // The processor already rate-limits us, so cap to SEARCH_CAP people.
    const targets = persons.slice(0, SEARCH_CAP);
    const matches: DisqualifiedDirectorMatch[] = [];

    for (const p of targets) {
      const name = (p.label || '').trim();
      if (!name) continue;
      let resp: any;
      try {
        resp = await this.ch.searchDisqualifiedOfficers(name);
      } catch (e: any) {
        // 404 means no hits — that's not an error in this context
        const status = e?.response?.status;
        if (status !== 404) this.logger.warn(`Disqualified search failed for ${name}: ${e?.message}`);
        continue;
      }
      const items = resp?.items || [];
      if (items.length === 0) continue;

      const personMatches: DisqualificationDetail[] = [];
      for (const item of items) {
        const candidateName = item.title || item.name || '';
        const conf = tokenSetSimilarity(name, candidateName);
        if (conf < FUZZY_THRESHOLD) continue;

        // Pull detail to get the disqualification reasons / dates
        const officerId = item.links?.self?.split('/').pop() || item.officer_id || '';
        let detail: any = null;
        try {
          if (officerId) detail = await this.ch.getDisqualifiedOfficer(officerId);
        } catch (e) { /* fall back to summary */ }

        const disq = (detail?.disqualifications || [])[0] || {};
        personMatches.push({
          officerId,
          matchedName: candidateName,
          fromDate: disq.disqualified_from || disq.from,
          toDate: disq.disqualified_until || disq.to,
          reason: disq.reason?.description_identifier || disq.reason?.act,
          caseRef: disq.case_identifier,
          isUndertaking: disq.undertaken_on != null,
          addressLine: item.address_snippet || item.address,
          confidence: conf,
        });
      }

      if (personMatches.length === 0) continue;
      // Sort by confidence desc
      personMatches.sort((a, b) => b.confidence - a.confidence);

      // Persist on node metadata
      const meta = { ...(p.metadata || {}), disqualifications: personMatches };
      p.metadata = meta;
      await this.nodes.update(p.id, { metadata: meta });

      matches.push({
        personNodeId: p.id,
        personName: name,
        matches: personMatches,
      });
    }

    this.logger.log(
      `DisqualifiedDirectors ${investigationId}: scanned=${targets.length} hits=${matches.length}`,
    );
    return matches;
  }
}
