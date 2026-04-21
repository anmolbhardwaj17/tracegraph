import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

export interface RiskNarrative {
  executiveSummary: string;
  keyFindings: string[];
  riskFactors: string[];
  recommendations: string[];
  pepWarnings: string[];
  adverseMedia: string[];
  generatedAt: string;
}

@Injectable()
export class AiNarrativeService {
  private readonly logger = new Logger(AiNarrativeService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  /**
   * Generate an analyst-quality risk narrative from investigation results.
   * Pre-computed during the pipeline, stored in investigation progress.
   */
  async generate(
    investigationId: string,
    companyName: string,
    jurisdiction: string,
    riskScore: number,
    findings: Finding[],
    pepResults?: Array<{ name: string; positions: string[] }>,
    adverseMediaResults?: Array<{ entity: string; headline: string; source: string; sentiment: string }>,
  ): Promise<RiskNarrative> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      this.logger.warn('OPENROUTER_API_KEY not set, generating rule-based narrative');
      return this.fallbackNarrative(companyName, jurisdiction, riskScore, findings, pepResults, adverseMediaResults);
    }

    // Gather entity stats
    const nodes = await this.nodes.find({ where: { investigationId } });
    const companies = nodes.filter((n) => n.entityType === 'company');
    const people = nodes.filter((n) => n.entityType === 'person');
    const addresses = nodes.filter((n) => n.entityType === 'address');
    const subsidiaries = companies.filter((c) => (c.metadata as any)?.isSubsidiary);

    // Root company enrichment data
    const root = nodes.find((n) => n.entityType === 'company' && (n.metadata as any)?.enriched);
    const rootMeta = (root?.metadata || {}) as any;

    const briefing = {
      companyName,
      jurisdiction,
      riskScore,
      riskLevel: riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW',
      revenue: rootMeta.revenue || null,
      employees: rootMeta.employeeCount || null,
      industry: rootMeta.industry || null,
      founded: rootMeta.foundedDate || null,
      website: rootMeta.website || null,
      network: {
        totalEntities: nodes.length,
        companies: companies.length,
        people: people.length,
        addresses: addresses.length,
        subsidiaries: subsidiaries.length,
        jurisdictions: [...new Set(subsidiaries.map((s) => (s.metadata as any)?.jurisdiction).filter(Boolean))],
      },
      findings: {
        total: findings.length,
        critical: findings.filter((f) => f.severity === 'CRITICAL').length,
        high: findings.filter((f) => f.severity === 'HIGH').length,
        medium: findings.filter((f) => f.severity === 'MEDIUM').length,
        low: findings.filter((f) => f.severity === 'LOW').length,
        topFindings: findings
          .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
          .slice(0, 5)
          .map((f) => ({ type: f.type, severity: f.severity, title: f.title })),
      },
      pep: pepResults?.map((p) => `${p.name}: ${p.positions.join(', ')}`) || [],
      adverseMedia: adverseMediaResults?.slice(0, 5).map((a) => `${a.entity}: "${a.headline}" (${a.source})`) || [],
    };

    const prompt = `You are a senior corporate intelligence analyst writing a due diligence report. Generate a structured risk narrative for the following company investigation.

INVESTIGATION BRIEFING:
${JSON.stringify(briefing, null, 2)}

Produce a JSON object with these fields:
- executiveSummary: 2-3 sentences summarizing the overall risk profile. Be specific about the company, mention key numbers.
- keyFindings: array of 3-5 bullet points (strings), each one sentence about the most important discoveries
- riskFactors: array of 2-4 bullet points about what contributes to the risk score
- recommendations: array of 2-3 actionable next steps for the compliance team
- pepWarnings: array of strings, one per PEP found (empty if none). Include name and position.
- adverseMedia: array of strings, one per adverse media hit (empty if none). Include entity and headline.

Guidelines:
- Be factual and specific. Use actual numbers from the briefing.
- Don't be alarmist for low-risk companies. If risk is LOW, say so clearly.
- For PEPs, explain why political exposure matters for this specific relationship.
- For adverse media, note what the compliance team should verify.
- Write for a compliance officer who needs to make a go/no-go decision.

Return ONLY valid JSON, no markdown fences, no commentary.`;

    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 1200,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tracegraph.local',
            'X-Title': 'TraceGraph',
          },
          timeout: 30000,
        },
      );

      const text: string = res.data?.choices?.[0]?.message?.content || '';
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      const narrative: RiskNarrative = {
        executiveSummary: parsed.executiveSummary || '',
        keyFindings: parsed.keyFindings || [],
        riskFactors: parsed.riskFactors || [],
        recommendations: parsed.recommendations || [],
        pepWarnings: parsed.pepWarnings || [],
        adverseMedia: parsed.adverseMedia || [],
        generatedAt: new Date().toISOString(),
      };

      this.logger.log(`AI narrative generated for "${companyName}": ${narrative.keyFindings.length} findings, ${narrative.pepWarnings.length} PEPs`);
      return narrative;
    } catch (e: any) {
      this.logger.warn(`AI narrative generation failed: ${e?.message}, using fallback`);
      return this.fallbackNarrative(companyName, jurisdiction, riskScore, findings, pepResults, adverseMediaResults);
    }
  }

  private fallbackNarrative(
    companyName: string,
    jurisdiction: string,
    riskScore: number,
    findings: Finding[],
    pepResults?: Array<{ name: string; positions: string[] }>,
    adverseMediaResults?: Array<{ entity: string; headline: string; source: string; sentiment: string }>,
  ): RiskNarrative {
    const level = riskScore >= 75 ? 'CRITICAL' : riskScore >= 50 ? 'HIGH' : riskScore >= 25 ? 'MEDIUM' : 'LOW';
    const critical = findings.filter((f) => f.severity === 'CRITICAL');
    const high = findings.filter((f) => f.severity === 'HIGH');

    let summary = `${companyName} presents a ${level} risk profile with an overall score of ${riskScore}/100. `;
    if (riskScore < 25) {
      summary += `The investigation found ${findings.length} findings, none requiring immediate action. Standard due diligence procedures are sufficient.`;
    } else if (riskScore < 50) {
      summary += `The investigation identified ${findings.length} findings including ${high.length} high-severity items that warrant review before proceeding.`;
    } else {
      summary += `The investigation flagged ${critical.length} critical and ${high.length} high-severity findings requiring immediate attention.`;
    }

    return {
      executiveSummary: summary,
      keyFindings: findings
        .filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
        .slice(0, 5)
        .map((f) => f.title),
      riskFactors: [
        `Risk score: ${riskScore}/100 (${level})`,
        `${findings.length} total findings across the network`,
        ...(pepResults?.length ? [`${pepResults.length} politically exposed person(s) in the network`] : []),
        ...(adverseMediaResults?.length ? [`${adverseMediaResults.length} adverse media hit(s) found`] : []),
      ],
      recommendations: riskScore < 25
        ? ['Proceed with standard onboarding', 'Schedule periodic review in 12 months']
        : riskScore < 50
        ? ['Review high-severity findings before proceeding', 'Request additional documentation from the company', 'Schedule enhanced monitoring review in 6 months']
        : ['Escalate to senior compliance for review', 'Request face-to-face meeting with beneficial owners', 'Consider enhanced due diligence (EDD) before proceeding'],
      pepWarnings: pepResults?.map((p) => `${p.name} holds/held political positions: ${p.positions.join(', ')}`) || [],
      adverseMedia: adverseMediaResults?.map((a) => `${a.entity}: "${a.headline}" — ${a.source}`) || [],
      generatedAt: new Date().toISOString(),
    };
  }
}
