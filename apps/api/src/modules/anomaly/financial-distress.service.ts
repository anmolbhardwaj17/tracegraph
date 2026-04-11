import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { CompaniesHouseService } from '../companies-house/companies-house.service';

const COMPANY_CAP = 20; // Max companies to fetch accounts for

export interface FinancialMetrics {
  totalAssets?: number;
  netAssets?: number;
  creditors?: number;
  creditorRatio?: number;
  negativeEquity: boolean;
  filings: Array<{ date: string; totalAssets?: number; netAssets?: number }>;
  assetTrend?: 'increasing' | 'declining' | 'stable';
  distressed: boolean;
  reasons: string[];
}

@Injectable()
export class FinancialDistressService {
  private readonly logger = new Logger(FinancialDistressService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    private readonly ch: CompaniesHouseService,
  ) {}

  async analyze(investigationId: string): Promise<{ analyzed: number; distressed: number }> {
    const nodes = await this.nodes.find({ where: { investigationId } });
    const companies = nodes
      .filter((n) => n.entityType === 'company' && n.entityId)
      .sort((a, b) => (b.metadata?.shellCompanyScore?.score || 0) - (a.metadata?.shellCompanyScore?.score || 0))
      .slice(0, COMPANY_CAP);

    let analyzed = 0;
    let distressed = 0;

    for (const c of companies) {
      try {
        const fh = await this.ch.getFilingHistory(c.entityId);
        const accountFilings = (fh?.items || [])
          .filter((f: any) => f.category === 'accounts' || /^accounts/.test(f.type || ''))
          .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 3);

        if (accountFilings.length === 0) continue;

        const filingData: FinancialMetrics['filings'] = [];
        const reasons: string[] = [];
        let latestAssets: number | undefined;
        let latestNetAssets: number | undefined;
        let latestCreditors: number | undefined;

        // Try to parse financial data from filing descriptions
        // CH filing descriptions for micro/small accounts often contain key figures
        for (const filing of accountFilings) {
          const desc = (filing.description || '').toLowerCase();
          const vals = filing.description_values || {};

          // Extract from accounts data if available
          let totalAssets: number | undefined;
          let netAssets: number | undefined;

          // Parse from common CH filing description patterns
          if (vals.total_assets_net_assets) {
            totalAssets = parseInt(vals.total_assets_net_assets, 10);
          }
          if (vals.net_assets) {
            netAssets = parseInt(vals.net_assets, 10);
          }

          filingData.push({
            date: filing.date,
            totalAssets,
            netAssets,
          });

          if (filingData.length === 1) {
            latestAssets = totalAssets;
            latestNetAssets = netAssets;
          }
        }

        // Compute metrics from available data
        let negativeEquity = false;
        let creditorRatio: number | undefined;
        let assetTrend: FinancialMetrics['assetTrend'];

        if (latestNetAssets != null && latestNetAssets < 0) {
          negativeEquity = true;
          reasons.push(`Negative net assets: ${latestNetAssets.toLocaleString()}`);
        }

        // Asset trend from filed data
        const assetValues = filingData.map((f) => f.totalAssets).filter((v): v is number => v != null);
        if (assetValues.length >= 2) {
          const latest = assetValues[0];
          const previous = assetValues[1];
          if (previous > 0) {
            const change = ((latest - previous) / previous) * 100;
            if (change < -50) {
              assetTrend = 'declining';
              reasons.push(`Assets declined ${Math.abs(Math.round(change))}% year-on-year`);
            } else if (change > 20) {
              assetTrend = 'increasing';
            } else {
              assetTrend = 'stable';
            }
          }
        }

        // Use company metadata for additional signals
        const accountsType = (c.metadata?.accountsType || '').toLowerCase();
        if (accountsType === 'dormant' && latestAssets != null && latestAssets > 100000) {
          reasons.push(`Dormant accounts but total assets ${latestAssets.toLocaleString()} - unusual`);
        }

        const isDistressed = negativeEquity || (assetTrend === 'declining') || reasons.length > 0;

        const metrics: FinancialMetrics = {
          totalAssets: latestAssets,
          netAssets: latestNetAssets,
          creditors: latestCreditors,
          creditorRatio,
          negativeEquity,
          filings: filingData,
          assetTrend,
          distressed: isDistressed,
          reasons,
        };

        c.metadata = { ...(c.metadata || {}), financialMetrics: metrics };
        await this.nodes.update(c.id, { metadata: c.metadata as any });
        analyzed++;
        if (isDistressed) distressed++;
      } catch {
        // Skip on error
      }
    }

    this.logger.log(`FinancialDistress ${investigationId}: analyzed=${analyzed} distressed=${distressed}`);
    return { analyzed, distressed };
  }
}
