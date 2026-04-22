import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Investigation } from '../investigation/entities/investigation.entity';

export interface TraceyMessage {
  role: 'user' | 'assistant';
  content: string;
}

const TRACEY_SYSTEM_PROMPT = `You are Tracey, a senior corporate intelligence consultant working at TraceGraph. You help compliance officers, investigators, and due diligence professionals understand investigation results.

YOUR PERSONALITY:
- Professional, concise, and direct
- You speak like a seasoned compliance consultant — confident but measured
- You reference specific data from the investigation (names, numbers, dates)
- You explain the "so what" — not just what the data says, but what it MEANS for the user's decision
- You proactively point out what matters most and what can be safely ignored

YOUR RULES:
1. ONLY discuss the investigation data provided in the context. Never make up data.
2. If asked something outside corporate intelligence (personal questions, flirting, coding, general knowledge), politely redirect: "I'm focused on your investigation. What would you like to know about [company name]?"
3. If the data doesn't contain an answer, say so clearly: "The investigation data doesn't cover that. You may want to check [specific source]."
4. Always reference WHERE your information comes from (e.g., "According to the SEC filings...", "The Wikidata enrichment shows...")
5. When discussing risk, always provide context — a "HIGH" score for a Fortune 500 company means something different than for a small LLC
6. Keep responses concise — 2-4 paragraphs max unless the user asks for detail
7. Use bullet points for lists of findings or recommendations
8. Never say "I think" or "I believe" — say "The data shows" or "Based on the investigation"

SUGGESTED RESPONSES:
When user asks vague questions like "what do you think?", proactively highlight:
- The most important finding and why
- Any PEP/sanctions flags
- Financial health summary
- What action they should take next`;

@Injectable()
export class TraceyService {
  private readonly logger = new Logger(TraceyService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
  ) {}

  /**
   * Chat with Tracey about an investigation.
   * Feeds investigation context + conversation history to LLM.
   */
  async chat(
    investigationId: string,
    question: string,
    history: TraceyMessage[] = [],
  ): Promise<{ reply: string; sources: string[] }> {
    // Build investigation context
    const context = await this.buildContext(investigationId);
    if (!context) {
      return { reply: "I can't find this investigation. It may still be processing — please check back once it's complete.", sources: [] };
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';

    if (!apiKey) {
      return this.fallbackResponse(question, context);
    }

    // Build messages
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: TRACEY_SYSTEM_PROMPT },
      { role: 'system', content: `INVESTIGATION CONTEXT:\n${context.briefing}` },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model, messages, temperature: 0.4, max_tokens: 800 },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tracegraph.local',
            'X-Title': 'TraceGraph Tracey',
          },
          timeout: 30000,
        },
      );

      const reply = res.data?.choices?.[0]?.message?.content || "I'm having trouble processing that. Could you rephrase your question?";
      return { reply, sources: context.sources };
    } catch (e: any) {
      this.logger.warn(`Tracey LLM failed: ${e?.message}`);
      return this.fallbackResponse(question, context);
    }
  }

  /** Build investigation context for Tracey */
  private async buildContext(investigationId: string): Promise<{ briefing: string; sources: string[] } | null> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    if (!inv || inv.status !== 'COMPLETE') return null;

    const nodes = await this.nodes.find({ where: { investigationId } });
    const companies = nodes.filter((n) => n.entityType === 'company');
    const people = nodes.filter((n) => n.entityType === 'person');
    const addresses = nodes.filter((n) => n.entityType === 'address');
    const progress = inv.progress || {} as any;
    const rootMeta = companies.find((c) => (c.metadata as any)?.enriched)?.metadata as any || {};

    const sources: string[] = [];
    const lines: string[] = [];

    // Company profile
    const companyName = inv.metadata?.companyName || inv.query;
    lines.push(`COMPANY: ${companyName}`);
    lines.push(`JURISDICTION: ${inv.metadata?.jurisdiction || 'Unknown'}`);
    lines.push(`RISK SCORE: ${progress.riskScore ?? 0}/100 (${progress.riskClassification || 'LOW'})`);
    if (rootMeta.revenue) { lines.push(`REVENUE: ${rootMeta.revenue}`); sources.push('SEC XBRL / Wikidata'); }
    if (rootMeta.employeeCount) lines.push(`EMPLOYEES: ${rootMeta.employeeCount}`);
    if (rootMeta.industry) lines.push(`INDUSTRY: ${rootMeta.industry}`);
    if (rootMeta.website) lines.push(`WEBSITE: ${rootMeta.website}`);
    if (rootMeta.foundedDate) lines.push(`FOUNDED: ${rootMeta.foundedDate}`);

    // Network
    lines.push(`\nNETWORK: ${companies.length} companies, ${people.length} people, ${addresses.length} addresses`);
    const subsidiaries = companies.filter((c) => (c.metadata as any)?.isSubsidiary);
    if (subsidiaries.length > 0) {
      lines.push(`SUBSIDIARIES (${subsidiaries.length}): ${subsidiaries.slice(0, 10).map((s) => s.label).join(', ')}${subsidiaries.length > 10 ? '...' : ''}`);
      sources.push('Wikidata / SEC 10-K');
    }

    // Key people
    const keyPeople = people.slice(0, 15).map((p) => {
      const m = p.metadata as any;
      const tags: string[] = [];
      if (m?.isPep) tags.push('PEP');
      if (m?.sanctionsHit) tags.push('SANCTIONED');
      if (m?.politicalDonations) tags.push(`FEC: $${m.politicalDonations.totalAmount?.toLocaleString()}`);
      return `${p.label} (${m?.role || 'Officer'})${tags.length ? ' [' + tags.join(', ') + ']' : ''}`;
    });
    if (keyPeople.length > 0) {
      lines.push(`\nKEY PEOPLE:\n${keyPeople.map((p) => `- ${p}`).join('\n')}`);
      sources.push('SEC Form 4 / Wikidata / FEC');
    }

    // Financials
    const fin = progress.secIntelligence?.financials;
    if (fin) {
      lines.push(`\nFINANCIALS:`);
      if (fin.profitMargin != null) lines.push(`- Profit margin: ${fin.profitMargin}%`);
      if (fin.debtToEquity != null) lines.push(`- Debt/equity: ${fin.debtToEquity}`);
      if (fin.currentRatio != null) lines.push(`- Current ratio: ${fin.currentRatio}`);
      if (fin.flags?.length > 0) lines.push(`- Flags: ${fin.flags.join(', ')}`);
      sources.push('SEC XBRL');
    }

    // Compliance signals
    lines.push(`\nCOMPLIANCE SIGNALS:`);
    lines.push(`- PEPs detected: ${progress.pepCount || 0}`);
    lines.push(`- Sanctions matches: ${progress.directSanctions?.matches || 0}`);
    lines.push(`- Adverse media hits: ${progress.adverseMediaCount || 0}`);
    lines.push(`- FATF jurisdiction flags: ${progress.fatfFlags || 0}`);
    lines.push(`- Court cases: ${progress.webIntelligence?.courtCases || 0}`);
    sources.push('OFAC / UK HMT / Wikidata P39 / GDELT / CourtListener');

    // Wayback
    if (progress.wayback?.firstSnapshot) {
      lines.push(`\nWEB PRESENCE: Online since ${progress.wayback.firstSnapshot} (${progress.wayback.domainAgeYears} years)`);
      sources.push('Wayback Machine');
    }

    // Findings (top 15)
    const findings = progress.findings || [];
    if (findings.length > 0) {
      const topFindings = findings
        .filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
        .slice(0, 10);
      const otherCount = findings.length - topFindings.length;
      lines.push(`\nTOP FINDINGS (${findings.length} total):`);
      for (const f of topFindings) {
        lines.push(`- [${f.severity}] ${f.title}`);
        if (f.description) lines.push(`  ${f.description.slice(0, 150)}`);
      }
      if (otherCount > 0) lines.push(`- ...and ${otherCount} more findings (MEDIUM/LOW)`);
    }

    // Narrative
    if (progress.narrative?.executiveSummary) {
      lines.push(`\nAI NARRATIVE: ${progress.narrative.executiveSummary}`);
      if (progress.narrative.pepWarnings?.length > 0) {
        lines.push(`PEP WARNINGS: ${progress.narrative.pepWarnings.join('; ')}`);
      }
      if (progress.narrative.recommendations?.length > 0) {
        lines.push(`RECOMMENDATIONS: ${progress.narrative.recommendations.join('; ')}`);
      }
    }

    return { briefing: lines.join('\n'), sources: [...new Set(sources)] };
  }

  /** Rule-based fallback when LLM is unavailable */
  private fallbackResponse(question: string, context: { briefing: string; sources: string[] }): { reply: string; sources: string[] } {
    const q = question.toLowerCase();
    const lines = context.briefing.split('\n');

    // Extract key data
    const scoreLine = lines.find((l) => l.startsWith('RISK SCORE:'));
    const score = scoreLine?.match(/(\d+)\/100/)?.[1] || '?';
    const classification = scoreLine?.match(/\((\w+)\)/)?.[1] || '?';
    const companyName = lines[0]?.replace('COMPANY: ', '') || 'this company';

    if (q.includes('risk') || q.includes('score') || q.includes('safe') || q.includes('concern')) {
      return {
        reply: `${companyName} has a risk score of ${score}/100 (${classification}). ` +
          `${parseInt(score) < 25 ? 'This is a low-risk profile — no major concerns were identified.' :
            parseInt(score) < 50 ? 'This is a moderate risk profile — review the HIGH-severity findings before proceeding.' :
            'This is an elevated risk profile — enhanced due diligence is recommended before proceeding.'}\n\n` +
          `Would you like me to explain specific findings in detail?`,
        sources: context.sources,
      };
    }

    if (q.includes('pep') || q.includes('political')) {
      const pepLine = lines.find((l) => l.includes('PEPs detected'));
      return {
        reply: pepLine ? `${pepLine.replace('- ', '')}. ` +
          `PEPs (Politically Exposed Persons) require enhanced due diligence under AML regulations. ` +
          `Would you like details on who was flagged and their positions?` :
          `No PEP data is available for this investigation.`,
        sources: ['Wikidata P39'],
      };
    }

    if (q.includes('sanction') || q.includes('ofac')) {
      const sanctionLine = lines.find((l) => l.includes('Sanctions matches'));
      return {
        reply: sanctionLine ? `${sanctionLine.replace('- ', '')}. ` +
          `The investigation screened against OFAC SDN (26K+ names), UK HMT (12K+ names), and EU consolidated sanctions lists.` :
          `No sanctions data available.`,
        sources: ['OFAC SDN', 'UK HMT', 'EU Sanctions'],
      };
    }

    if (q.includes('financial') || q.includes('revenue') || q.includes('profit')) {
      const finLines = lines.filter((l) => l.includes('Profit margin') || l.includes('Debt/equity') || l.includes('Current ratio') || l.includes('REVENUE'));
      return {
        reply: finLines.length > 0 ?
          `Here's the financial snapshot for ${companyName}:\n${finLines.map((l) => l.trim()).join('\n')}\n\nWould you like me to compare this against industry peers?` :
          `Financial data is limited for this investigation. The company may not have public filings.`,
        sources: ['SEC XBRL'],
      };
    }

    // Default response
    return {
      reply: `I'm Tracey, your corporate intelligence consultant. Based on the investigation data for ${companyName} (risk score: ${score}/100), I can help you understand:\n\n` +
        `- **Risk assessment** — what the score means and key concerns\n` +
        `- **PEP & sanctions** — political exposure and sanctions matches\n` +
        `- **Financial health** — margins, leverage, and anomalies\n` +
        `- **Key findings** — what needs attention vs what's routine\n` +
        `- **Recommendations** — specific next steps for your due diligence\n\n` +
        `What would you like to know about ${companyName}?`,
      sources: context.sources,
    };
  }
}
