import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface LinkedInProfile {
  found: boolean;
  name: string | null;
  tagline: string | null;
  industry: string | null;
  employeeCount: string | null;
  employeeRange: string | null;
  headquarters: string | null;
  founded: string | null;
  specialties: string[];
  linkedinUrl: string | null;
  websiteUrl: string | null;
}

/**
 * LinkedIn Company Intelligence Service.
 *
 * Uses Google search to find LinkedIn company pages and extract
 * publicly available information:
 * - Employee count and growth
 * - Industry classification
 * - Headquarters location
 * - Company description/tagline
 * - Specialties
 *
 * This does NOT scrape LinkedIn directly (which would violate ToS).
 * Instead, it uses Google's cached/indexed version of LinkedIn pages.
 */
@Injectable()
export class LinkedInIntelligenceService {
  private readonly logger = new Logger(LinkedInIntelligenceService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(investigationId: string, companyName: string): Promise<{ profile: LinkedInProfile; findings: Finding[] }> {
    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    this.logger.log(`LinkedIn search: "${searchName}"`);
    const profile = await this.findCompanyProfile(searchName);
    const findings = this.generateFindings(companyName, profile);

    // Update root node
    if (profile.found) {
      try {
        const rootNode = await this.nodes.findOne({
          where: { investigationId, entityType: 'company' },
          order: { id: 'ASC' },
        });
        if (rootNode) {
          const meta = (rootNode.metadata || {}) as any;
          meta.linkedin = {
            found: true,
            employeeCount: profile.employeeCount,
            industry: profile.industry,
            headquarters: profile.headquarters,
            url: profile.linkedinUrl,
          };
          await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});
        }
      } catch {}
    }

    this.logger.log(`LinkedIn complete: ${profile.found ? `found (${profile.employeeCount || '?'} employees)` : 'not found'}`);
    return { profile, findings };
  }

  private async findCompanyProfile(name: string): Promise<LinkedInProfile> {
    return cached(`linkedin:${name.toLowerCase()}`, async () => {
      const empty: LinkedInProfile = {
        found: false, name: null, tagline: null, industry: null,
        employeeCount: null, employeeRange: null, headquarters: null,
        founded: null, specialties: [], linkedinUrl: null, websiteUrl: null,
      };

      try {
        // Use Google to find the LinkedIn company page
        // Search for: site:linkedin.com/company "CompanyName"
        const searchQuery = `site:linkedin.com/company "${name}"`;
        const res = await axios.get('https://www.google.com/search', {
          params: { q: searchQuery, num: 3 },
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 10000,
        });

        const html = res.data as string;

        // Extract LinkedIn URL from Google results
        const urlMatch = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-z0-9\-]+/i);
        if (!urlMatch) return empty;

        const linkedinUrl = urlMatch[0];

        // Extract info from Google's snippet/cache
        // Google often shows employee count, industry, and location in the snippet
        const snippet = html
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&#\d+;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ');

        // Employee count patterns
        const empMatch = snippet.match(/(\d[\d,]+)\+?\s*(?:employees?|followers|staff|people)/i)
          || snippet.match(/(?:employees?|staff|people)\s*[:\-–]\s*(\d[\d,]+)/i);

        // Industry
        const indMatch = snippet.match(/(?:Industry|Sector)\s*[:\-–]\s*([A-Za-z\s&,]+?)(?:\.|;|\s{2})/i);

        // Headquarters
        const hqMatch = snippet.match(/(?:Headquarters?|HQ|Location|Based in)\s*[:\-–]\s*([A-Za-z\s,]+?)(?:\.|;|\s{2}|Employees)/i);

        // Founded
        const foundedMatch = snippet.match(/(?:Founded|Established|Since)\s*(?:in\s*)?(\d{4})/i);

        return {
          found: true,
          name: name,
          tagline: null,
          industry: indMatch?.[1]?.trim() || null,
          employeeCount: empMatch?.[1]?.replace(/,/g, '') || null,
          employeeRange: empMatch?.[0] || null,
          headquarters: hqMatch?.[1]?.trim() || null,
          founded: foundedMatch?.[1] || null,
          specialties: [],
          linkedinUrl,
          websiteUrl: null,
        };
      } catch (e: any) {
        this.logger.warn(`LinkedIn search failed for "${name}": ${e?.message}`);
        return empty;
      }
    });
  }

  private generateFindings(companyName: string, profile: LinkedInProfile): Finding[] {
    const findings: Finding[] = [];

    if (!profile.found) {
      findings.push({
        type: 'NO_LINKEDIN_PRESENCE',
        severity: 'LOW',
        confidence: 'MEDIUM',
        title: `No LinkedIn company page found for ${companyName}`,
        description: `No LinkedIn company page was found for "${companyName}". Most legitimate operating companies maintain a LinkedIn presence. Absence may indicate a shell entity, very small business, or newly formed company.`,
        evidence: ['Google search for LinkedIn company page returned no results'],
        affectedEntities: [],
        recommendation: 'Verify the company maintains social media presence. No LinkedIn page is unusual for established businesses.',
      });
    } else if (profile.employeeCount) {
      const empNum = parseInt(profile.employeeCount.replace(/,/g, ''), 10);
      if (empNum < 5) {
        findings.push({
          type: 'MICRO_LINKEDIN_PRESENCE',
          severity: 'LOW',
          confidence: 'LOW',
          title: `Very small LinkedIn presence (${profile.employeeCount} employees)`,
          description: `${companyName}'s LinkedIn page shows only ${profile.employeeCount} employees. This is consistent with a small business but unusual if the company claims to be larger.`,
          evidence: [
            `LinkedIn employee count: ${profile.employeeCount}`,
            profile.linkedinUrl ? `LinkedIn URL: ${profile.linkedinUrl}` : '',
          ].filter(Boolean),
          affectedEntities: [],
          recommendation: 'Cross-reference LinkedIn employee count with company claims and SEC filings.',
        });
      }
    }

    return findings;
  }
}
