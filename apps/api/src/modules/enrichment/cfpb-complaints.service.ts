import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const CFPB_API = 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 12 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface CfpbResult {
  totalComplaints: number;
  recentComplaints: number;
  topProducts: Array<{ product: string; count: number }>;
  topIssues: Array<{ issue: string; count: number }>;
  disputeRate: number;
  timelyResponseRate: number;
}

/**
 * CFPB Consumer Complaints Service.
 *
 * Searches the Consumer Financial Protection Bureau's complaint database
 * for complaints filed against the company. Free API, no key needed.
 *
 * Useful for: banks, fintechs, credit card companies, lenders, debt collectors,
 * insurance companies, and any consumer-facing financial entity.
 */
@Injectable()
export class CfpbComplaintsService {
  private readonly logger = new Logger(CfpbComplaintsService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(investigationId: string, companyName: string): Promise<{ result: CfpbResult; findings: Finding[] }> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    this.logger.log(`CFPB search: "${searchName}"`);
    const result = await this.queryComplaints(searchName);
    const findings = this.generateFindings(companyName, result);

    // Update root node
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company' },
        order: { id: 'ASC' },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.cfpbComplaints = {
          total: result.totalComplaints,
          recent: result.recentComplaints,
          disputeRate: result.disputeRate,
          timelyResponseRate: result.timelyResponseRate,
        };
        await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});
      }
    } catch {}

    this.logger.log(`CFPB complete: ${result.totalComplaints} total, ${result.recentComplaints} recent`);
    return { result, findings };
  }

  private async queryComplaints(name: string): Promise<CfpbResult> {
    return cached(`cfpb:${name.toLowerCase()}`, async () => {
      try {
        const res = await axios.get(CFPB_API, {
          params: {
            company: name,
            size: 0, // we only want aggregations
            date_received_min: new Date(Date.now() - 3 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const total = res.data?.hits?.total?.value || res.data?.hits?.total || 0;

        // Get recent (last 12 months)
        const recentRes = await axios.get(CFPB_API, {
          params: {
            company: name,
            size: 10,
            date_received_min: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            sort: 'date_received_desc',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const recentTotal = recentRes.data?.hits?.total?.value || recentRes.data?.hits?.total || 0;
        const recentHits = recentRes.data?.hits?.hits || [];

        // Aggregate products and issues
        const products: Record<string, number> = {};
        const issues: Record<string, number> = {};
        let disputed = 0;
        let timely = 0;
        let counted = 0;

        for (const hit of recentHits) {
          const src = hit._source || {};
          if (src.product) products[src.product] = (products[src.product] || 0) + 1;
          if (src.issue) issues[src.issue] = (issues[src.issue] || 0) + 1;
          if (src.consumer_disputed === 'Yes') disputed++;
          if (src.timely === 'Yes') timely++;
          counted++;
        }

        return {
          totalComplaints: total,
          recentComplaints: recentTotal,
          topProducts: Object.entries(products)
            .map(([product, count]) => ({ product, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          topIssues: Object.entries(issues)
            .map(([issue, count]) => ({ issue, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5),
          disputeRate: counted > 0 ? Math.round((disputed / counted) * 100) : 0,
          timelyResponseRate: counted > 0 ? Math.round((timely / counted) * 100) : 0,
        };
      } catch (e: any) {
        this.logger.warn(`CFPB query failed: ${e?.message}`);
        return { totalComplaints: 0, recentComplaints: 0, topProducts: [], topIssues: [], disputeRate: 0, timelyResponseRate: 0 };
      }
    });
  }

  private generateFindings(companyName: string, result: CfpbResult): Finding[] {
    const findings: Finding[] = [];

    if (result.totalComplaints > 100) {
      findings.push({
        type: 'CFPB_COMPLAINTS',
        severity: result.totalComplaints > 10000 ? 'HIGH' : result.totalComplaints > 1000 ? 'MEDIUM' : 'LOW',
        confidence: 'HIGH',
        title: `${result.totalComplaints.toLocaleString()} CFPB consumer complaints (${result.recentComplaints.toLocaleString()} in last year)`,
        description: `${companyName} has ${result.totalComplaints.toLocaleString()} consumer complaints filed with the CFPB. ` +
          `${result.recentComplaints.toLocaleString()} were filed in the last 12 months. ` +
          `${result.topProducts.length > 0 ? `Top complaint products: ${result.topProducts.map((p) => p.product).join(', ')}. ` : ''}` +
          `Timely response rate: ${result.timelyResponseRate}%.`,
        evidence: [
          `Total complaints (3yr): ${result.totalComplaints.toLocaleString()}`,
          `Recent (12mo): ${result.recentComplaints.toLocaleString()}`,
          ...result.topIssues.slice(0, 3).map((i) => `Issue: ${i.issue} (${i.count})`),
        ],
        affectedEntities: [],
        recommendation: 'Compare complaint volume with industry peers. High complaint volumes for the company\'s size may indicate systemic consumer issues.',
      });
    }

    return findings;
  }
}
