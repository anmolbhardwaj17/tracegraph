import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const PROPUBLICA_API = 'https://projects.propublica.org/nonprofits/api/v2';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface NonprofitResult {
  found: boolean;
  ein: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  nteeCode: string | null;
  totalRevenue: number | null;
  totalAssets: number | null;
  totalExpenses: number | null;
  taxPeriod: string | null;
}

/**
 * ProPublica Nonprofit Explorer (IRS 990).
 *
 * Checks if the company or related entities are nonprofits.
 * If found, retrieves IRS 990 financial data: revenue, assets, expenses.
 * Free API, no key needed.
 */
@Injectable()
export class NonprofitLookupService {
  private readonly logger = new Logger(NonprofitLookupService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(investigationId: string, companyName: string): Promise<{ result: NonprofitResult; findings: Finding[] }> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    this.logger.log(`Nonprofit lookup: "${searchName}"`);
    const result = await this.queryProPublica(searchName);
    const findings = this.generateFindings(companyName, result);

    if (result.found) {
      try {
        const rootNode = await this.nodes.findOne({
          where: { investigationId, entityType: 'company' },
          order: { id: 'ASC' },
        });
        if (rootNode) {
          const meta = (rootNode.metadata || {}) as any;
          meta.nonprofit = {
            ein: result.ein,
            revenue: result.totalRevenue,
            assets: result.totalAssets,
            nteeCode: result.nteeCode,
          };
          await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});
        }
      } catch {}
    }

    this.logger.log(`Nonprofit lookup complete: ${result.found ? `found (EIN: ${result.ein})` : 'not a nonprofit'}`);
    return { result, findings };
  }

  private async queryProPublica(name: string): Promise<NonprofitResult> {
    return cached(`nonprofit:${name.toLowerCase()}`, async () => {
      try {
        const res = await axios.get(`${PROPUBLICA_API}/search.json`, {
          params: { q: name },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const orgs = res.data?.organizations || [];
        if (orgs.length === 0) {
          return { found: false, ein: null, name: null, city: null, state: null, nteeCode: null, totalRevenue: null, totalAssets: null, totalExpenses: null, taxPeriod: null };
        }

        // Find best match
        const target = name.toLowerCase();
        const best = orgs.find((o: any) => (o.name || '').toLowerCase().includes(target)) || orgs[0];

        // Get detailed financials
        let revenue = best.income_amount || null;
        let assets = best.asset_amount || null;
        let expenses = null;
        let taxPeriod = best.tax_period?.toString() || null;

        // Try to get full 990 filing details
        if (best.ein) {
          try {
            const detailRes = await axios.get(`${PROPUBLICA_API}/organizations/${best.ein}.json`, {
              headers: { 'User-Agent': USER_AGENT },
              timeout: 10000,
            });
            const org = detailRes.data?.organization || {};
            const filing = detailRes.data?.filings_with_data?.[0] || {};
            revenue = filing.totrevenue || org.income_amount || revenue;
            assets = filing.totassetsend || org.asset_amount || assets;
            expenses = filing.totfuncexpns || null;
            taxPeriod = filing.tax_prd?.toString() || taxPeriod;
          } catch {}
        }

        return {
          found: true,
          ein: best.ein?.toString() || null,
          name: best.name || null,
          city: best.city || null,
          state: best.state || null,
          nteeCode: best.ntee_code || null,
          totalRevenue: revenue,
          totalAssets: assets,
          totalExpenses: expenses,
          taxPeriod,
        };
      } catch (e: any) {
        this.logger.warn(`ProPublica query failed: ${e?.message}`);
        return { found: false, ein: null, name: null, city: null, state: null, nteeCode: null, totalRevenue: null, totalAssets: null, totalExpenses: null, taxPeriod: null };
      }
    });
  }

  private generateFindings(companyName: string, result: NonprofitResult): Finding[] {
    if (!result.found) return [];

    const findings: Finding[] = [];
    const rev = result.totalRevenue ? `$${(result.totalRevenue / 1e6).toFixed(1)}M` : 'unknown';

    findings.push({
      type: 'NONPROFIT_ENTITY',
      severity: 'LOW',
      confidence: 'HIGH',
      title: `${companyName} is a registered nonprofit (EIN: ${result.ein})`,
      description: `${result.name || companyName} is registered as a 501(c) nonprofit organization with the IRS. ` +
        `Revenue: ${rev}. Assets: ${result.totalAssets ? '$' + (result.totalAssets / 1e6).toFixed(1) + 'M' : 'unknown'}. ` +
        `NTEE code: ${result.nteeCode || 'N/A'}. Nonprofit entities have different regulatory requirements and tax obligations.`,
      evidence: [
        `EIN: ${result.ein}`,
        `Location: ${result.city}, ${result.state}`,
        `Revenue: ${rev}`,
        `Tax period: ${result.taxPeriod || 'N/A'}`,
      ],
      affectedEntities: [],
      recommendation: 'Verify the nonprofit status is consistent with the entity\'s stated purpose. Review IRS 990 for executive compensation and related-party transactions.',
    });

    return findings;
  }
}
