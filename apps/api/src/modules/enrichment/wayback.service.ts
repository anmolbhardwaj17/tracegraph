import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const WAYBACK_CDX = 'https://web.archive.org/cdx/search/cdx';
const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface WaybackResult {
  domain: string;
  exists: boolean;
  firstSnapshot: string | null;
  lastSnapshot: string | null;
  totalSnapshots: number;
  domainAgeYears: number | null;
  flags: string[];
}

/**
 * Wayback Machine Historical Website Analysis.
 *
 * Uses the Internet Archive's CDX API to check:
 * - When the company website first appeared online
 * - How many historical snapshots exist
 * - Whether the website age is consistent with company age
 *
 * Shell company signals:
 * - Website didn't exist until recently for a "10-year old" company
 * - Very few snapshots = minimal web presence history
 * - No snapshots at all = company may not have a real web presence
 */
@Injectable()
export class WaybackService {
  private readonly logger = new Logger(WaybackService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async analyze(
    investigationId: string,
    companyName: string,
    website: string | null,
    incorporationDate: string | null,
  ): Promise<{ result: WaybackResult; findings: Finding[] }> {
    const domain = this.extractDomain(website) || this.guessDomain(companyName);
    if (!domain) {
      return {
        result: { domain: '', exists: false, firstSnapshot: null, lastSnapshot: null, totalSnapshots: 0, domainAgeYears: null, flags: ['NO_DOMAIN'] },
        findings: [],
      };
    }

    this.logger.log(`Wayback Machine: checking ${domain}`);
    const result = await this.checkDomain(domain);
    const findings = this.generateFindings(companyName, result, incorporationDate);

    // Update root node metadata
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company' },
        order: { id: 'ASC' },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.wayback = {
          domain,
          firstSnapshot: result.firstSnapshot,
          totalSnapshots: result.totalSnapshots,
          domainAgeYears: result.domainAgeYears,
          flags: result.flags,
        };
        await this.nodes.update(rootNode.id, { metadata: meta });
      }
    } catch {}

    this.logger.log(
      `Wayback Machine complete: ${domain} — ${result.totalSnapshots} snapshots, ` +
      `first: ${result.firstSnapshot || 'never'}, ${result.flags.length} flags`,
    );

    return { result, findings };
  }

  private async checkDomain(domain: string): Promise<WaybackResult> {
    return cached(`wayback:${domain}`, async () => {
      const result: WaybackResult = {
        domain,
        exists: false,
        firstSnapshot: null,
        lastSnapshot: null,
        totalSnapshots: 0,
        domainAgeYears: null,
        flags: [],
      };

      try {
        // Get first snapshot (oldest)
        const firstRes = await axios.get(WAYBACK_CDX, {
          params: {
            url: domain,
            output: 'json',
            limit: 1,
            fl: 'timestamp,statuscode',
            filter: 'statuscode:200',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const firstData = firstRes.data;
        if (Array.isArray(firstData) && firstData.length > 1) {
          result.exists = true;
          const timestamp = firstData[1][0]; // YYYYMMDDHHMMSS
          result.firstSnapshot = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

          const firstDate = new Date(result.firstSnapshot);
          result.domainAgeYears = Math.round((Date.now() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10) / 10;
        }

        // Get last snapshot (most recent) + count
        const lastRes = await axios.get(WAYBACK_CDX, {
          params: {
            url: domain,
            output: 'json',
            limit: -1, // last result
            fl: 'timestamp',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        if (Array.isArray(lastRes.data) && lastRes.data.length > 1) {
          const timestamp = lastRes.data[lastRes.data.length - 1][0];
          result.lastSnapshot = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
        }

        // Get total snapshot count
        const countRes = await axios.get(WAYBACK_CDX, {
          params: {
            url: domain,
            output: 'json',
            fl: 'timestamp',
            limit: 10000,
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        if (Array.isArray(countRes.data)) {
          result.totalSnapshots = Math.max(0, countRes.data.length - 1); // subtract header row
        }

        // Generate flags
        if (!result.exists) {
          result.flags.push('NO_WEB_ARCHIVE');
        } else {
          if (result.domainAgeYears !== null && result.domainAgeYears < 1) {
            result.flags.push('WEBSITE_UNDER_1_YEAR');
          }
          if (result.domainAgeYears !== null && result.domainAgeYears < 0.5) {
            result.flags.push('WEBSITE_VERY_NEW');
          }
          if (result.totalSnapshots < 10) {
            result.flags.push('MINIMAL_ARCHIVE_HISTORY');
          }
          if (result.totalSnapshots < 3) {
            result.flags.push('ALMOST_NO_ARCHIVE');
          }
        }
      } catch (e: any) {
        this.logger.warn(`Wayback CDX query failed for ${domain}: ${e?.message}`);
        result.flags.push('CHECK_FAILED');
      }

      return result;
    });
  }

  private generateFindings(companyName: string, result: WaybackResult, incorporationDate: string | null): Finding[] {
    const findings: Finding[] = [];

    if (result.flags.includes('NO_WEB_ARCHIVE')) {
      findings.push({
        type: 'NO_WEB_HISTORY',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${companyName} has no web archive history`,
        description: `The Internet Archive (Wayback Machine) has no snapshots of ${result.domain}. This means the website has either never existed or was never indexed. For an established business, this is unusual.`,
        evidence: [`Domain checked: ${result.domain}`, 'Total Wayback Machine snapshots: 0'],
        affectedEntities: [],
        recommendation: 'Verify the company maintains a legitimate web presence. No web history is a common shell company indicator.',
      });
    }

    // Check website age vs company age mismatch
    if (result.firstSnapshot && incorporationDate) {
      const webDate = new Date(result.firstSnapshot);
      const incDate = new Date(incorporationDate);
      const companyAgeYears = (Date.now() - incDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      const webAgeYears = result.domainAgeYears || 0;

      if (companyAgeYears > 5 && webAgeYears < 1) {
        findings.push({
          type: 'WEBSITE_AGE_MISMATCH',
          severity: 'HIGH',
          confidence: 'MEDIUM',
          title: `Website is ${webAgeYears.toFixed(1)} years old but company is ${companyAgeYears.toFixed(0)} years old`,
          description: `${companyName} was incorporated around ${incorporationDate} (${companyAgeYears.toFixed(0)} years ago) but its website first appeared on the Wayback Machine on ${result.firstSnapshot} (${webAgeYears.toFixed(1)} years ago). A ${companyAgeYears.toFixed(0)}-year-old company with less than 1 year of web history is suspicious.`,
          evidence: [
            `Company incorporation: ${incorporationDate}`,
            `First web snapshot: ${result.firstSnapshot}`,
            `Total snapshots: ${result.totalSnapshots}`,
          ],
          affectedEntities: [],
          recommendation: 'Investigate why an old company has a very new website. This could indicate a recently acquired dormant company or a fraudulent entity using an old registration.',
        });
      }
    }

    if (result.flags.includes('ALMOST_NO_ARCHIVE') && result.exists) {
      findings.push({
        type: 'THIN_WEB_HISTORY',
        severity: 'LOW',
        confidence: 'MEDIUM',
        title: `Minimal web presence history (${result.totalSnapshots} snapshots)`,
        description: `${result.domain} has only ${result.totalSnapshots} snapshot(s) in the Wayback Machine, indicating very limited historical web presence. Active businesses typically accumulate dozens to hundreds of snapshots over time.`,
        evidence: [
          `First snapshot: ${result.firstSnapshot}`,
          `Last snapshot: ${result.lastSnapshot}`,
          `Total snapshots: ${result.totalSnapshots}`,
        ],
        affectedEntities: [],
        recommendation: 'Consider whether the limited web history is consistent with the reported business scale and age.',
      });
    }

    return findings;
  }

  private extractDomain(url: string | null): string | null {
    if (!url) return null;
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  private guessDomain(companyName: string): string | null {
    const clean = companyName
      .toLowerCase()
      .replace(/\b(inc|corp|ltd|plc|llc|co|gmbh|sa|ag|nv|bv|group|holdings)\b\.?/gi, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();
    if (clean.length < 2) return null;
    return `${clean}.com`;
  }
}
