import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence; contact@tracegraph.com)';

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 2000 - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface PepResult {
  name: string;
  nodeId: string;
  entityId: string;
  positions: string[];
  countries: string[];
  wikidataId: string;
  isPep: true;
}

/**
 * PEP (Politically Exposed Persons) Detection Service.
 *
 * For each person in the investigation graph, queries Wikidata to check
 * if they hold or have held political/government positions (property P39).
 *
 * PEP categories detected:
 * - Heads of state / government
 * - Ministers / cabinet members
 * - Members of parliament / congress
 * - Senior judges
 * - Military leaders
 * - Ambassadors
 * - Central bank governors
 * - State enterprise board members
 * - Political party leadership
 */
@Injectable()
export class PepDetectionService {
  private readonly logger = new Logger(PepDetectionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  /**
   * Screen all person nodes in an investigation for PEP status.
   * Returns PEP results + findings to add to the risk score.
   */
  async screen(investigationId: string): Promise<{ peps: PepResult[]; findings: Finding[] }> {
    const people = await this.nodes.find({
      where: { investigationId, entityType: 'person' },
    });

    if (people.length === 0) return { peps: [], findings: [] };

    this.logger.log(`PEP screening: checking ${people.length} people in investigation ${investigationId}`);

    const peps: PepResult[] = [];
    const findings: Finding[] = [];

    // Process people in batches of 5
    for (let i = 0; i < people.length; i += 5) {
      const batch = people.slice(i, i + 5);
      const results = await Promise.all(
        batch.map((p) => this.checkPerson(p).catch(() => null)),
      );

      for (const result of results) {
        if (!result) continue;
        peps.push(result);

        // Update the person node metadata
        await this.nodes.update(result.nodeId, {
          metadata: {
            ...(await this.nodes.findOne({ where: { id: result.nodeId } }))?.metadata as any,
            isPep: true,
            pepPositions: result.positions,
            pepCountries: result.countries,
            pepWikidataId: result.wikidataId,
          },
        });

        // Create a finding
        findings.push({
          type: 'PEP_DETECTED',
          severity: 'HIGH',
          confidence: 'HIGH',
          title: `${result.name} is a Politically Exposed Person`,
          description: `${result.name} holds or has held political/government positions: ${result.positions.join(', ')}. ` +
            `PEPs require enhanced due diligence (EDD) under AML regulations. ` +
            `Associated jurisdictions: ${result.countries.join(', ') || 'Unknown'}.`,
          evidence: [
            `Wikidata entity: ${result.wikidataId}`,
            ...result.positions.map((p) => `Position: ${p}`),
          ],
          affectedEntities: [result.entityId],
          recommendation: `Apply enhanced due diligence procedures for ${result.name}. Verify source of funds and the nature of the business relationship. Document the PEP screening result and rationale for proceeding.`,
        });
      }
    }

    this.logger.log(`PEP screening complete: ${peps.length} PEP(s) found out of ${people.length} people`);
    return { peps, findings };
  }

  /** Check a single person against Wikidata for political positions */
  private async checkPerson(node: GraphNode): Promise<PepResult | null> {
    const name = node.label;
    if (!name || name.length < 3) return null;

    // Normalize name for search (remove SEC-style prefixes)
    const cleanName = name
      .replace(/^(Mr|Mrs|Ms|Dr|Prof|Sir|Lord|Lady|Baron|Baroness)\.\s*/i, '')
      .replace(/\s+(Jr|Sr|III|IV|II)\s*\.?$/i, '')
      .trim();

    return cached(`pep:${cleanName.toLowerCase()}`, async () => {
      try {
        // Step 1: Find the person on Wikidata
        const searchRes = await rl(() =>
          axios.get('https://www.wikidata.org/w/api.php', {
            params: {
              action: 'wbsearchentities',
              search: cleanName,
              language: 'en',
              type: 'item',
              limit: 3,
              format: 'json',
            },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000,
          }),
        );

        const candidates = searchRes.data?.search || [];
        if (candidates.length === 0) return null;

        // Try each candidate — look for one that has political positions
        for (const candidate of candidates) {
          const desc = (candidate.description || '').toLowerCase();
          // Quick filter: skip if description is clearly not a person
          if (desc.includes('album') || desc.includes('film') || desc.includes('song') || desc.includes('species')) continue;

          const entityId = candidate.id;

          // Step 2: Check for political/government positions (P39)
          const query = `
            SELECT ?posLabel ?countryLabel WHERE {
              wd:${entityId} wdt:P39 ?pos .
              ?pos rdfs:label ?posLabel . FILTER(LANG(?posLabel) = "en")
              OPTIONAL { wd:${entityId} wdt:P27 ?country . ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
            }
            LIMIT 20
          `;

          const sparqlRes = await rl(() =>
            axios.get(WIKIDATA_SPARQL, {
              params: { query, format: 'json' },
              headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
              timeout: 15000,
            }),
          );

          const bindings = sparqlRes.data?.results?.bindings || [];
          if (bindings.length === 0) continue;

          // Filter for actual political/government positions
          const politicalPositions: string[] = [];
          const countries = new Set<string>();

          for (const b of bindings) {
            const pos = b.posLabel?.value || '';
            const posLower = pos.toLowerCase();

            // Check if this is a political/government position
            if (
              posLower.includes('president') || posLower.includes('prime minister') ||
              posLower.includes('minister') || posLower.includes('secretary of') ||
              posLower.includes('senator') || posLower.includes('representative') ||
              posLower.includes('member of') && (posLower.includes('parliament') || posLower.includes('congress') || posLower.includes('senate') || posLower.includes('assembly')) ||
              posLower.includes('governor') || posLower.includes('mayor') ||
              posLower.includes('ambassador') || posLower.includes('judge') ||
              posLower.includes('commissioner') || posLower.includes('attorney general') ||
              posLower.includes('chairman of the') || posLower.includes('speaker of') ||
              posLower.includes('chief of staff') || posLower.includes('admiral') ||
              posLower.includes('general of') || posLower.includes('commander') ||
              posLower.includes('director of') && (posLower.includes('intelligence') || posLower.includes('fbi') || posLower.includes('cia') || posLower.includes('nsa'))
            ) {
              politicalPositions.push(pos);
              if (b.countryLabel?.value) countries.add(b.countryLabel.value);
            }
          }

          if (politicalPositions.length > 0) {
            // Verify name match — the Wikidata entity label should somewhat match
            const wdLabel = (candidate.label || '').toLowerCase();
            const targetName = cleanName.toLowerCase();
            const targetParts = targetName.split(/\s+/);
            const wdParts = wdLabel.split(/\s+/);

            // At least surname should match
            const lastNameMatch = targetParts.some((p: string) => wdParts.some((w: string) => w === p && p.length > 2));
            if (!lastNameMatch) continue;

            return {
              name: node.label,
              nodeId: node.id,
              entityId: node.entityId,
              positions: [...new Set(politicalPositions)],
              countries: [...countries],
              wikidataId: entityId,
              isPep: true as const,
            };
          }
        }

        return null;
      } catch (e: any) {
        this.logger.warn(`PEP check failed for "${cleanName}": ${e?.message}`);
        return null;
      }
    });
  }
}
