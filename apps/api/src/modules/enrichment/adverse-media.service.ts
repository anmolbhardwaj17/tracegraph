import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const GDELT_API = 'https://api.gdeltproject.org/api/v2/doc/doc';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h for news

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface AdverseMediaHit {
  entity: string;
  entityNodeId: string;
  headline: string;
  url: string;
  source: string;
  date: string;
  sentiment: 'negative' | 'mixed' | 'neutral';
  keywords: string[];
}

/** Negative keywords that indicate adverse media */
const ADVERSE_KEYWORDS = [
  'fraud', 'scam', 'scandal', 'corruption', 'bribery', 'money laundering',
  'embezzlement', 'indictment', 'indicted', 'arrested', 'convicted', 'sentenced',
  'lawsuit', 'sued', 'litigation', 'regulatory action', 'fine', 'penalty',
  'violation', 'sanction', 'sanctioned', 'investigation', 'investigated',
  'probe', 'whistleblower', 'misconduct', 'negligence', 'breach',
  'insider trading', 'securities fraud', 'tax evasion', 'antitrust',
  'cartel', 'price fixing', 'environmental violation', 'data breach',
  'bankruptcy', 'default', 'delinquent', 'foreclosure',
];

/**
 * Adverse Media Screening Service.
 *
 * Searches free news APIs (GDELT) for negative media coverage of
 * key entities in the investigation graph. Flags fraud, corruption,
 * lawsuits, regulatory actions, and other risk-relevant news.
 */
@Injectable()
export class AdverseMediaService {
  private readonly logger = new Logger(AdverseMediaService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  /**
   * Screen key entities for adverse media.
   * Checks: root company + all people with significant roles.
   */
  async screen(investigationId: string, rootCompanyName: string): Promise<{ hits: AdverseMediaHit[]; findings: Finding[] }> {
    const allHits: AdverseMediaHit[] = [];
    const findings: Finding[] = [];

    // Get key entities to screen
    const people = await this.nodes.find({
      where: { investigationId, entityType: 'person' },
    });

    // Screen root company
    const companyHits = await this.searchEntity(rootCompanyName, '', investigationId);
    allHits.push(...companyHits);

    // Screen key people (executives, board members, PEPs — max 5 to avoid rate limits)
    const keyPeople = people
      .filter((p) => {
        const meta = p.metadata as any;
        return meta?.isPep || meta?.personType === 'executive' || meta?.personType === 'board' ||
               meta?.isDirector || meta?.role?.toLowerCase()?.includes('ceo');
      })
      .slice(0, 5);

    for (const person of keyPeople) {
      try {
        // Rate limit: 3s between GDELT requests to avoid 429
        await new Promise((r) => setTimeout(r, 3000));
        const hits = await this.searchEntity(person.label, person.id, investigationId);
        allHits.push(...hits);
      } catch { /* continue */ }
    }

    // Convert hits to findings
    if (allHits.length > 0) {
      // Group hits by entity
      const byEntity = new Map<string, AdverseMediaHit[]>();
      for (const hit of allHits) {
        const key = hit.entity;
        if (!byEntity.has(key)) byEntity.set(key, []);
        byEntity.get(key)!.push(hit);
      }

      for (const [entity, hits] of byEntity) {
        const negativeHits = hits.filter((h) => h.sentiment === 'negative');
        const severity = negativeHits.length >= 3 ? 'HIGH' : negativeHits.length >= 1 ? 'MEDIUM' : 'LOW';

        findings.push({
          type: 'ADVERSE_MEDIA',
          severity,
          confidence: 'MEDIUM',
          title: `${negativeHits.length} adverse media hit${negativeHits.length !== 1 ? 's' : ''} for ${entity}`,
          description: `Media screening found ${hits.length} news article${hits.length !== 1 ? 's' : ''} mentioning "${entity}" with adverse keywords. ` +
            `${negativeHits.length} article${negativeHits.length !== 1 ? 's are' : ' is'} classified as negative sentiment. ` +
            `Keywords found: ${[...new Set(hits.flatMap((h) => h.keywords))].join(', ')}.`,
          evidence: hits.slice(0, 5).map((h) => `${h.date}: "${h.headline}" — ${h.source}`),
          affectedEntities: [hits[0]?.entityNodeId].filter(Boolean),
          recommendation: `Review the flagged articles to determine if any represent material risk. ` +
            `Cross-reference with regulatory databases for formal actions. ` +
            `Document the adverse media screening result for compliance records.`,
        });

        // Update node metadata
        if (hits[0]?.entityNodeId) {
          try {
            const node = await this.nodes.findOne({ where: { id: hits[0].entityNodeId } });
            if (node) {
              await this.nodes.update(node.id, {
                metadata: {
                  ...(node.metadata as any),
                  adverseMedia: {
                    hitCount: hits.length,
                    negativeCount: negativeHits.length,
                    topHeadlines: hits.slice(0, 3).map((h) => h.headline),
                    keywords: [...new Set(hits.flatMap((h) => h.keywords))],
                    screenedAt: new Date().toISOString(),
                  },
                },
              });
            }
          } catch { /* non-critical */ }
        }
      }
    }

    this.logger.log(`Adverse media screening: ${allHits.length} hits across ${new Set(allHits.map((h) => h.entity)).size} entities`);
    return { hits: allHits, findings };
  }

  /** Search GDELT for adverse news about an entity */
  private async searchEntity(entityName: string, nodeId: string, investigationId: string): Promise<AdverseMediaHit[]> {
    // Clean name for search
    const searchName = entityName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    if (searchName.length < 3) return [];

    return cached(`media:${searchName.toLowerCase()}:${investigationId}`, async () => {
      // Retry up to 2 times on 429
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // GDELT DOC API — free, no key needed
        const query = `"${searchName}" (${ADVERSE_KEYWORDS.slice(0, 10).join(' OR ')})`;
        const res = await axios.get(GDELT_API, {
          params: {
            query,
            mode: 'artlist',
            maxrecords: 10,
            format: 'json',
            timespan: '6m', // 6 months to reduce load
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 20000,
        });

        const articles = res.data?.articles || [];
        const hits: AdverseMediaHit[] = [];

        for (const article of articles.slice(0, 10)) {
          const title = (article.title || '').toLowerCase();
          const matchedKeywords = ADVERSE_KEYWORDS.filter((kw) => title.includes(kw));
          if (matchedKeywords.length === 0) continue;

          hits.push({
            entity: entityName,
            entityNodeId: nodeId,
            headline: article.title || '',
            url: article.url || '',
            source: article.domain || article.source?.name || 'Unknown',
            date: article.seendate?.slice(0, 10) || '',
            sentiment: matchedKeywords.length >= 2 ? 'negative' : 'mixed',
            keywords: matchedKeywords,
          });
        }

        return hits;
      } catch (e: any) {
        // Retry on 429
        if (e?.response?.status === 429 && attempt === 0) {
          this.logger.log(`GDELT 429 for "${searchName}", retrying in 5s...`);
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        this.logger.warn(`GDELT search failed for "${searchName}": ${e?.message}`);
        return [];
      }
      }
      return [];
    });
  }
}
