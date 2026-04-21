import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface PatentResult {
  totalPatents: number;
  recentPatents: number;
  topCategories: string[];
  sampleTitles: string[];
}

/**
 * Patent / IP Search Service.
 *
 * Searches the USPTO PatentsView API for patents assigned to the company.
 * Shows innovation activity and IP assets.
 * Free API, no key needed.
 */
@Injectable()
export class PatentSearchService {
  private readonly logger = new Logger(PatentSearchService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(investigationId: string, companyName: string): Promise<{ result: PatentResult; findings: Finding[] }> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    this.logger.log(`Patent search: "${searchName}"`);
    const result = await this.queryPatents(searchName);
    const findings = this.generateFindings(companyName, result);

    // Update root node
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company' },
        order: { id: 'ASC' },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.patents = { total: result.totalPatents, recent: result.recentPatents, categories: result.topCategories };
        await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});
      }
    } catch {}

    this.logger.log(`Patent search complete: ${result.totalPatents} patents found`);
    return { result, findings };
  }

  private async queryPatents(name: string): Promise<PatentResult> {
    return cached(`patents:${name.toLowerCase()}`, async () => {
      try {
        // Google Patents public search (no API key needed)
        const res = await axios.get('https://patents.google.com/xhr/query', {
          params: {
            url: `assignee="${name}"`,
            num: 25,
            type: 'PATENT',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const results = res.data?.results?.cluster || [];
        const patents = results.flatMap((c: any) => c.result || []);
        const total = res.data?.results?.total_num_results || patents.length;

        // Count recent (last 2 years)
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const recent = patents.filter((p: any) => {
          const date = p.patent?.publication_date || p.patent?.filing_date || '';
          return date && new Date(date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) > twoYearsAgo;
        }).length;

        const categories: string[] = [...new Set(patents.map((p: any) => p.patent?.type || '').filter(Boolean) as string[])];
        const titles = patents.slice(0, 5).map((p: any) => p.patent?.title || '');

        return { totalPatents: total, recentPatents: recent, topCategories: categories, sampleTitles: titles };
      } catch (e: any) {
        this.logger.warn(`PatentsView query failed: ${e?.message}`);
        return { totalPatents: 0, recentPatents: 0, topCategories: [], sampleTitles: [] };
      }
    });
  }

  private generateFindings(companyName: string, result: PatentResult): Finding[] {
    if (result.totalPatents === 0) return [];
    return [{
      type: 'PATENT_PORTFOLIO',
      severity: 'LOW',
      confidence: 'HIGH',
      title: `${result.totalPatents.toLocaleString()} patents held (${result.recentPatents} in last 2 years)`,
      description: `${companyName} holds ${result.totalPatents.toLocaleString()} US patents. ` +
        `${result.recentPatents} were granted in the last 2 years, indicating ${result.recentPatents > 10 ? 'active' : 'moderate'} innovation. ` +
        `Patent portfolios represent significant IP assets that may affect valuation and competitive positioning.`,
      evidence: result.sampleTitles.slice(0, 3).map((t) => `Patent: "${t}"`),
      affectedEntities: [],
      recommendation: 'Patent holdings confirm operational legitimacy and R&D investment. Consider IP risk in any M&A context.',
    }];
  }
}
