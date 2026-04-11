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
      // Compute relations to split findings into target / directors / network
      const rootNumber = inv.metadata?.companyNumber;
      const targetName = inv.metadata?.companyName || inv.query;
      const rootNode = companies.find((n) => n.entityId === rootNumber);

      // Build entity ID sets for target and directors
      const targetIds = new Set<string>();
      const directorIds = new Set<string>();
      const directorNames = new Map<string, string>(); // id -> name
      if (rootNode) {
        targetIds.add(rootNode.id);
        targetIds.add(rootNode.entityId);
      }
      // Simple: directors/PSCs are people nodes connected to target
      // We'll use affectedEntities containing target id as proxy
      const nodeById = new Map<string, GraphNode>();
      const nodeByEid = new Map<string, GraphNode>();
      for (const n of [...companies, ...people, ...addresses]) {
        nodeById.set(n.id, n);
        if (n.entityId) nodeByEid.set(n.entityId, n);
      }
      // Find people who appear with the target in findings
      for (const f of findings) {
        const ae = f.affectedEntities || [];
        const hitsTarget = ae.some((id: string) => targetIds.has(id));
        if (hitsTarget) {
          for (const id of ae) {
            const node = nodeById.get(id) || nodeByEid.get(id);
            if (node && node.entityType === 'person') {
              directorIds.add(node.id);
              if (node.entityId) directorIds.add(node.entityId);
              directorNames.set(node.id, node.label);
            }
          }
        }
      }
      // Also include all people nodes as potential directors
      for (const p of people) {
        directorIds.add(p.id);
        if (p.entityId) directorIds.add(p.entityId);
        directorNames.set(p.id, p.label);
      }

      // Classify findings
      const targetFindings: any[] = [];
      const directorFindings: any[] = [];
      const networkFindings: any[] = [];
      for (const f of findings) {
        const ae = f.affectedEntities || [];
        if (ae.some((id: string) => targetIds.has(id))) targetFindings.push(f);
        else if (ae.some((id: string) => directorIds.has(id))) directorFindings.push(f);
        else networkFindings.push(f);
      }

      // Severity breakdown per section
      const sevOf = (list: any[]) => {
        const s: Record<string, number> = {};
        for (const f of list) s[f.severity] = (s[f.severity] || 0) + 1;
        return s;
      };

      // Top affected entities with resolved names
      const entityCount: Record<string, { count: number; name: string }> = {};
      for (const f of [...targetFindings, ...directorFindings]) {
        for (const id of f.affectedEntities || []) {
          const node = nodeById.get(id) || nodeByEid.get(id);
          const name = node?.label || id;
          if (!entityCount[name]) entityCount[name] = { count: 0, name };
          entityCount[name].count++;
        }
      }
      const topAffected = Object.values(entityCount)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      return {
        ...baseTarget,
        targetName,
        totalFindings: findings.length,
        targetFindingsCount: targetFindings.length,
        directorFindingsCount: directorFindings.length,
        networkFindingsCount: networkFindings.length,
        targetSeverity: sevOf(targetFindings),
        directorSeverity: sevOf(directorFindings),
        targetFindingSummary: targetFindings.slice(0, 5).map((f: any) => ({
          severity: f.severity, type: f.type, title: f.title,
        })),
        directorFindingSummary: directorFindings.slice(0, 5).map((f: any) => ({
          severity: f.severity, type: f.type, title: f.title,
        })),
        topAffectedEntities: topAffected,
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
      return `You are a senior corporate intelligence analyst. The investigation target is "${briefing.targetName}". Given this findings breakdown, produce 3 to 4 sharp insights focused on what matters for the TARGET COMPANY specifically:
- Does the target company itself have direct risk signals? If not, say so clearly.
- What about the people who run it (directors/PSCs) - are they individually risky?
- Is there anything in the wider network that reflects back on the target?
Do NOT just restate counts. Explain the "so what" for someone deciding whether to do business with ${briefing.targetName}.
Each insight: JSON object with title (max 8 words), body (1-2 sentences), severity (CRITICAL, HIGH, MEDIUM, or INFO). Return ONLY a JSON array, no prose.

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
      const targetName = briefing.targetName || 'Target company';
      const targetCount = briefing.targetFindingsCount || 0;
      const directorCount = briefing.directorFindingsCount || 0;
      const networkCount = briefing.networkFindingsCount || 0;
      const targetSev = briefing.targetSeverity || {};

      // Insight 1: Target company status
      if (targetCount === 0) {
        insights.push({
          severity: 'INFO',
          title: `${targetName} has no direct risk signals`,
          body: `No findings were raised directly against the target company. All ${briefing.totalFindings.toLocaleString()} findings relate to the wider network.`,
        });
      } else {
        const critCount = targetSev.CRITICAL || 0;
        const highCount = targetSev.HIGH || 0;
        if (critCount > 0) {
          insights.push({
            severity: 'CRITICAL',
            title: `${targetName} has ${critCount} critical finding${critCount > 1 ? 's' : ''}`,
            body: `The target company itself is flagged with critical risk signals - review these before the wider network.`,
          });
        } else {
          insights.push({
            severity: highCount > 0 ? 'HIGH' : 'MEDIUM',
            title: `${targetCount} finding${targetCount > 1 ? 's' : ''} on ${targetName}`,
            body: `The target company has ${highCount > 0 ? highCount + ' high-severity' : 'moderate'} findings - these are your primary concern.`,
          });
        }
      }

      // Insight 2: Director risk
      if (directorCount > 0) {
        const dirSev = briefing.directorSeverity || {};
        const dirCrit = dirSev.CRITICAL || 0;
        insights.push({
          severity: dirCrit > 0 ? 'CRITICAL' : 'HIGH',
          title: `${directorCount} findings about directors`,
          body: `People running ${targetName} have ${directorCount} risk signals across their other appointments${dirCrit > 0 ? ', including critical findings' : ''}.`,
        });
      } else {
        insights.push({
          severity: 'INFO',
          title: 'Directors appear clean',
          body: `No risk signals detected on directors or PSCs of ${targetName}.`,
        });
      }

      // Insight 3: Network context
      if (networkCount > 0) {
        insights.push({
          severity: 'INFO',
          title: `${networkCount.toLocaleString()} findings in wider network`,
          body: `These are about companies and people beyond the target's immediate circle - relevant for deep due diligence but not primary concerns.`,
        });
      }

      // Insight 4: Most flagged entity (with resolved name)
      if (briefing.topAffectedEntities?.length > 0) {
        const top = briefing.topAffectedEntities[0];
        if (top.count > 3) {
          insights.push({
            severity: 'HIGH',
            title: `${top.name} is the most flagged entity`,
            body: `Appears in ${top.count} different findings - investigate this entity's role in the network.`,
          });
        }
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
