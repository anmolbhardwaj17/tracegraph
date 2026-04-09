import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Investigation } from '../investigation/entities/investigation.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';

export interface Insight {
  title: string;
  body: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
}

export type InsightTopic = 'overview' | 'findings' | 'entities';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly cache = new Map<string, Insight[]>();

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(EntityMatch) private readonly matches: Repository<EntityMatch>,
  ) {}

  async generate(investigationId: string, topic: InsightTopic = 'overview'): Promise<Insight[]> {
    const cacheKey = `${investigationId}:${topic}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    if (!inv) return [];

    const nodes = await this.nodes.find({ where: { investigationId } });
    const matches = await this.matches.find({ where: { investigationId } });

    const companies = nodes.filter((n) => n.entityType === 'company');
    const people = nodes.filter((n) => n.entityType === 'person');
    const addresses = nodes.filter((n) => n.entityType === 'address');
    const findings = inv.progress?.findings || [];

    const briefing = this.buildBriefing(topic, inv, companies, people, addresses, findings, matches);
    const prompt = this.buildPrompt(topic, briefing);

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      this.logger.warn('OPENROUTER_API_KEY not set, returning rule-based insights only');
      return this.fallbackInsights(topic, briefing);
    }

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tracegraph.local',
            'X-Title': 'TraceGraph',
          },
          timeout: 25000,
        },
      );

      const text: string = res.data?.choices?.[0]?.message?.content || '';
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      const insights: Insight[] = Array.isArray(parsed)
        ? parsed.filter((p) => p?.title && p?.body)
        : [];
      this.cache.set(cacheKey, insights);
      return insights;
    } catch (e: any) {
      this.logger.warn(`OpenRouter insights failed: ${e?.message}, falling back to rule-based`);
      return this.fallbackInsights(topic, briefing);
    }
  }

  private buildBriefing(
    topic: InsightTopic,
    inv: Investigation,
    companies: GraphNode[],
    people: GraphNode[],
    addresses: GraphNode[],
    findings: any[],
    matches: EntityMatch[],
  ): any {
    const baseTarget = {
      target: inv.metadata?.companyName || inv.query,
      tier: inv.tier,
      riskScore: inv.progress?.riskScore,
    };

    if (topic === 'findings') {
      const bySeverity: Record<string, number> = {};
      const byType: Record<string, number> = {};
      for (const f of findings) {
        bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
        byType[f.type] = (byType[f.type] || 0) + 1;
      }
      // Most affected entities
      const entityCount: Record<string, number> = {};
      for (const f of findings) {
        for (const e of f.affectedEntities || []) {
          entityCount[e] = (entityCount[e] || 0) + 1;
        }
      }
      const topAffected = Object.entries(entityCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({ id, findingCount: count }));
      return {
        ...baseTarget,
        totalFindings: findings.length,
        severityBreakdown: bySeverity,
        typeBreakdown: byType,
        topFindings: findings.slice(0, 6).map((f: any) => ({
          severity: f.severity,
          type: f.type,
          title: f.title,
          confidence: f.confidence,
        })),
        mostAffectedEntities: topAffected,
      };
    }

    if (topic === 'entities') {
      const companyProfiles: Record<string, number> = {};
      for (const c of companies) {
        const p = c.metadata?.companyProfile || 'UNKNOWN';
        companyProfiles[p] = (companyProfiles[p] || 0) + 1;
      }
      const directorProfiles: Record<string, number> = {};
      for (const p of people) {
        const r = p.metadata?.directorProfile?.risk || 'NORMAL';
        directorProfiles[r] = (directorProfiles[r] || 0) + 1;
      }
      const addressClasses: Record<string, number> = {};
      for (const a of addresses) {
        const c = a.metadata?.addressAnalysis?.classification || 'NORMAL';
        addressClasses[c] = (addressClasses[c] || 0) + 1;
      }
      const jurisdictions: Record<string, number> = {};
      for (const c of companies) {
        const j = c.metadata?.jurisdiction;
        if (j) jurisdictions[j] = (jurisdictions[j] || 0) + 1;
      }
      return {
        ...baseTarget,
        counts: {
          companies: companies.length,
          people: people.length,
          addresses: addresses.length,
        },
        companyProfiles,
        directorProfiles,
        addressClasses,
        jurisdictions,
      };
    }

    // overview (default) — keep original
    return {
      ...baseTarget,
      counts: {
        companies: companies.length,
        people: people.length,
        addresses: addresses.length,
        findings: findings.length,
      },
      topFindings: findings.slice(0, 8).map((f: any) => ({
        severity: f.severity,
        title: f.title,
        description: f.description,
        evidence: f.evidence?.slice(0, 3),
      })),
      matches: matches.slice(0, 5).map((m) => ({
        source: m.matchedSource,
        confidence: m.confidenceScore,
        matchedName: m.matchReasons?.matchedName,
      })),
      flaggedAddresses: addresses
        .filter((a) => a.metadata?.addressAnalysis?.classification && a.metadata.addressAnalysis.classification !== 'NORMAL')
        .slice(0, 5)
        .map((a) => ({ label: a.label, density: a.metadata?.addressAnalysis?.density })),
    };
  }

  private buildPrompt(topic: InsightTopic, briefing: any): string {
    if (topic === 'findings') {
      return `You are a senior corporate intelligence analyst. Given this breakdown of risk findings, produce 3 to 4 sharp insights about PATTERNS across the findings — what dominates, which entities cluster the most, what the severity distribution implies. Each insight is a JSON object: title (max 8 words), body (1-2 sentences explaining the so-what), severity (CRITICAL, HIGH, MEDIUM, or INFO). Return ONLY a JSON array, no prose.

BRIEFING:
${JSON.stringify(briefing, null, 2)}`;
    }
    if (topic === 'entities') {
      return `You are a senior corporate intelligence analyst. Given this breakdown of the network composition, produce 3 to 4 sharp insights about WHAT THIS NETWORK LOOKS LIKE — director profile patterns, classification breakdowns, jurisdictional spread, dominant address types. Each insight is a JSON object: title (max 8 words), body (1-2 sentences explaining the so-what), severity (CRITICAL, HIGH, MEDIUM, or INFO). Return ONLY a JSON array, no prose.

BRIEFING:
${JSON.stringify(briefing, null, 2)}`;
    }
    return `You are a senior corporate intelligence analyst. Given the following investigation briefing on a UK company, produce 4 to 5 sharp, executive-level insights. Each insight must be a JSON object with: title (max 8 words), body (1-2 punchy sentences explaining the so-what), severity (CRITICAL, HIGH, MEDIUM, or INFO). Focus on patterns and what they imply for risk — not restating the data. Return ONLY a JSON array, no prose.

BRIEFING:
${JSON.stringify(briefing, null, 2)}`;
  }

  private fallbackInsights(topic: InsightTopic, briefing: any): Insight[] {
    if (topic === 'findings') {
      const insights: Insight[] = [];
      const sev = briefing.severityBreakdown || {};
      const totalCritical = (sev.CRITICAL || 0);
      const totalHigh = (sev.HIGH || 0);
      if (totalCritical > 0) {
        insights.push({
          severity: 'CRITICAL',
          title: `${totalCritical} critical findings raised`,
          body: 'Critical findings indicate converging signals — review each immediately.',
        });
      }
      const types = Object.entries(briefing.typeBreakdown || {}).sort((a: any, b: any) => b[1] - a[1]);
      if (types.length > 0) {
        const [topType, topCount] = types[0] as [string, number];
        insights.push({
          severity: 'INFO',
          title: `${topType} dominates`,
          body: `${topCount} of ${briefing.totalFindings} findings are of type ${topType}.`,
        });
      }
      if (briefing.mostAffectedEntities?.length > 0) {
        const top = briefing.mostAffectedEntities[0];
        insights.push({
          severity: 'HIGH',
          title: 'Single entity carries most risk',
          body: `One entity (${top.id}) appears in ${top.findingCount} different findings.`,
        });
      }
      if (totalHigh > 3 && totalCritical === 0) {
        insights.push({
          severity: 'HIGH',
          title: 'Pattern of elevated risk without critical signals',
          body: `${totalHigh} HIGH findings without any CRITICAL — typical of structural patterns rather than acute exposure.`,
        });
      }
      return insights;
    }

    if (topic === 'entities') {
      const insights: Insight[] = [];
      const cp = briefing.companyProfiles || {};
      const dp = briefing.directorProfiles || {};
      const ac = briefing.addressClasses || {};
      const dominantProfile = Object.entries(cp).sort((a: any, b: any) => b[1] - a[1])[0];
      if (dominantProfile) {
        insights.push({
          severity: 'INFO',
          title: `Network dominated by ${dominantProfile[0].replace(/_/g, ' ').toLowerCase()}`,
          body: `${dominantProfile[1]} of ${briefing.counts.companies} companies fall into this profile.`,
        });
      }
      if (dp.NOMINEE_PATTERN > 0 || dp.FORMATION_AGENT > 0) {
        insights.push({
          severity: 'HIGH',
          title: `${(dp.NOMINEE_PATTERN || 0) + (dp.FORMATION_AGENT || 0)} suspicious director profiles`,
          body: 'Network contains directors matching nominee or formation-agent patterns — likely fronting other parties.',
        });
      }
      if (ac.VIRTUAL_OFFICE > 0 || ac.FORMATION_AGENT > 0) {
        insights.push({
          severity: 'HIGH',
          title: `${(ac.VIRTUAL_OFFICE || 0) + (ac.FORMATION_AGENT || 0)} flagged addresses`,
          body: 'Virtual office or formation-agent addresses host significantly more entities than typical.',
        });
      }
      const jurisdictions = Object.keys(briefing.jurisdictions || {});
      if (jurisdictions.length > 0) {
        insights.push({
          severity: 'INFO',
          title: `${jurisdictions.length} jurisdictions in network`,
          body: `Cross-border footprint spans ${jurisdictions.join(', ')}.`,
        });
      }
      return insights;
    }

    // overview fallback (existing)
    const insights: Insight[] = [];
    if (briefing.riskScore >= 60) {
      insights.push({
        severity: 'CRITICAL',
        title: 'High aggregate risk score',
        body: `Overall risk score of ${briefing.riskScore}/100 indicates multiple converging signals require immediate review.`,
      });
    }
    if (briefing.matches?.length > 0) {
      insights.push({
        severity: 'HIGH',
        title: `${briefing.matches.length} cross-source matches`,
        body: `Network includes entities matched against sanctions or offshore datasets — verify identity and document review.`,
      });
    }
    if (briefing.flaggedAddresses?.length > 0) {
      insights.push({
        severity: 'MEDIUM',
        title: 'Virtual office concentration',
        body: `${briefing.flaggedAddresses.length} addresses host abnormally many companies — possible service-address obfuscation.`,
      });
    }
    insights.push({
      severity: 'INFO',
      title: 'Network mapped',
      body: `${briefing.counts.companies} companies, ${briefing.counts.people} people, and ${briefing.counts.addresses} addresses across the ownership graph.`,
    });
    return insights;
  }
}
