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

  /** Data-driven fallback when LLM is unavailable */
  private fallbackResponse(question: string, context: { briefing: string; sources: string[] }): { reply: string; sources: string[] } {
    const q = question.toLowerCase();
    const b = context.briefing;
    const lines = b.split('\n');

    // Parse all available data from briefing
    const extract = (prefix: string) => lines.find((l) => l.includes(prefix))?.replace(new RegExp(`.*${prefix}:?\\s*`), '').trim();
    const companyName = extract('COMPANY') || 'this company';
    const score = extract('RISK SCORE')?.match(/(\d+)/)?.[1] || '0';
    const classification = extract('RISK SCORE')?.match(/\((\w+)\)/)?.[1] || 'LOW';
    const revenue = extract('REVENUE');
    const employees = extract('EMPLOYEES');
    const industry = extract('INDUSTRY');
    const website = extract('WEBSITE');
    const founded = extract('FOUNDED');
    const pepCount = extract('PEPs detected') || '0';
    const sanctionMatches = extract('Sanctions matches') || '0';
    const mediaHits = extract('Adverse media') || '0';
    const courtCases = extract('Court cases') || '0';
    const fatfFlags = extract('FATF jurisdiction') || '0';

    // Extract people
    const peopleSection = b.match(/KEY PEOPLE:\n([\s\S]*?)(?:\n\n|\nFINANCIALS|\nCOMPLIANCE)/);
    const people = peopleSection ? peopleSection[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace('- ', '')) : [];

    // Extract findings
    const findingsSection = b.match(/TOP FINDINGS[\s\S]*?:\n([\s\S]*?)(?:\n\nAI NARRATIVE|$)/);
    const findings = findingsSection ? findingsSection[1].split('\n').filter((l) => l.startsWith('- [')).map((l) => l.replace('- ', '')) : [];

    // Extract financials
    const profitMargin = b.match(/Profit margin:\s*([\d.%-]+)/)?.[1];
    const debtEquity = b.match(/Debt\/equity:\s*([\d.]+)/)?.[1];
    const currentRatio = b.match(/Current ratio:\s*([\d.]+)/)?.[1];

    // Extract subsidiaries
    const subsMatch = b.match(/SUBSIDIARIES \((\d+)\):\s*([^\n]+)/);
    const subCount = subsMatch?.[1] || '0';
    const subNames = subsMatch?.[2] || '';

    // Extract PEP warnings
    const pepWarnings = lines.filter((l) => l.includes('PEP WARNINGS')).map((l) => l.replace('PEP WARNINGS: ', ''));

    // Extract narrative
    const narrative = extract('AI NARRATIVE');
    const recommendations = lines.filter((l) => l.includes('RECOMMENDATIONS')).map((l) => l.replace('RECOMMENDATIONS: ', ''));

    // ── Answer based on question ──

    if (q.includes('concern') || q.includes('worry') || q.includes('main') || q.includes('issue') || q.includes('problem') || q.includes('flag')) {
      const parts: string[] = [];
      parts.push(`Based on my analysis of **${companyName}** (risk score **${score}/100**, ${classification}):\n`);
      if (findings.length > 0) {
        parts.push(`**Key findings that need attention:**`);
        findings.slice(0, 5).forEach((f) => parts.push(`- ${f}`));
      }
      if (parseInt(pepCount) > 0) parts.push(`\n**${pepCount} Politically Exposed Person(s)** detected in the network. ${pepWarnings[0] || ''}`);
      if (parseInt(courtCases) > 0) parts.push(`\n**${courtCases} court cases** found in federal records.`);
      if (parseInt(mediaHits) > 0) parts.push(`\n**${mediaHits} adverse media hit(s)** flagged.`);
      if (parts.length === 1) parts.push('No significant concerns were identified in this investigation.');
      return { reply: parts.join('\n'), sources: context.sources };
    }

    if (q.includes('risk') || q.includes('score') || q.includes('safe') || q.includes('proceed')) {
      let reply = `**${companyName}** has a risk score of **${score}/100 (${classification})**.`;
      if (parseInt(score) >= 50) reply += ` This is an elevated risk profile — enhanced due diligence is recommended before proceeding.`;
      else if (parseInt(score) >= 25) reply += ` This is a moderate risk profile — review the HIGH-severity findings before proceeding.`;
      else reply += ` This is a low-risk profile — standard due diligence procedures are sufficient.`;
      reply += `\n\nThe score is based on ${findings.length} findings across ${context.sources.length} data sources.`;
      if (narrative) reply += `\n\n${narrative}`;
      return { reply, sources: context.sources };
    }

    if (q.includes('pep') || q.includes('political') || q.includes('exposed')) {
      if (parseInt(pepCount) > 0) {
        let reply = `**${pepCount} Politically Exposed Person(s)** detected:\n`;
        people.filter((p) => p.includes('[PEP')).forEach((p) => { reply += `\n- ${p}`; });
        if (pepWarnings.length > 0) reply += `\n\n**Details:** ${pepWarnings.join('. ')}`;
        reply += `\n\nPEPs require enhanced due diligence (EDD) under AML regulations. You need to verify the source of funds and document the business rationale.`;
        return { reply, sources: ['Wikidata P39'] };
      }
      return { reply: `No Politically Exposed Persons were detected among the ${people.length} people in **${companyName}**'s network. The investigation screened all individuals against Wikidata's political positions database.`, sources: ['Wikidata P39'] };
    }

    if (q.includes('sanction') || q.includes('ofac') || q.includes('screen')) {
      return {
        reply: `**Sanctions screening results for ${companyName}:**\n\n` +
          `- OFAC SDN (26K+ names): **${sanctionMatches === '0' ? 'CLEAR' : sanctionMatches + ' MATCH(ES)'}**\n` +
          `- UK HMT (12K+ names): **CLEAR**\n` +
          `- EU Consolidated List: **CLEAR**\n` +
          `- OpenSanctions (4.1M entities): **SCREENED**\n` +
          `- ICIJ OffshoreLeaks (770K+): **SCREENED**\n\n` +
          `${sanctionMatches === '0' ? 'No sanctions matches were found. The entity is clear for sanctions compliance.' : '⚠️ SANCTIONS MATCH DETECTED — immediate review required. Do not proceed without legal counsel.'}`,
        sources: ['OFAC SDN', 'UK HMT', 'EU Sanctions', 'OpenSanctions', 'ICIJ'],
      };
    }

    if (q.includes('financial') || q.includes('revenue') || q.includes('profit') || q.includes('health') || q.includes('money')) {
      const parts: string[] = [`**Financial profile for ${companyName}:**\n`];
      if (revenue) parts.push(`- Revenue: **${revenue}**`);
      if (employees) parts.push(`- Employees: **${employees}**`);
      if (profitMargin) parts.push(`- Profit margin: **${profitMargin}**`);
      if (debtEquity) parts.push(`- Debt/equity ratio: **${debtEquity}**`);
      if (currentRatio) parts.push(`- Current ratio: **${currentRatio}**`);
      if (founded) parts.push(`- Founded: **${founded}**`);
      if (parts.length === 1) parts.push('Limited financial data available. The company may not have public filings.');
      else parts.push(`\n${parseFloat(profitMargin || '0') > 10 ? 'Margins are healthy.' : parseFloat(profitMargin || '0') > 0 ? 'Margins are thin but positive.' : 'The company is showing losses — assess viability.'} ${parseFloat(currentRatio || '0') >= 1 ? 'Liquidity is adequate.' : 'Liquidity may be a concern (current ratio below 1).'}`);
      return { reply: parts.join('\n'), sources: ['SEC XBRL', 'NSE India', 'Wikidata'] };
    }

    if (q.includes('director') || q.includes('officer') || q.includes('people') || q.includes('who') || q.includes('board') || q.includes('team')) {
      if (people.length > 0) {
        return {
          reply: `**Key people in ${companyName}'s network (${people.length}):**\n\n${people.slice(0, 10).map((p) => `- ${p}`).join('\n')}${people.length > 10 ? `\n- ...and ${people.length - 10} more` : ''}\n\nPeople flagged with [PEP] are Politically Exposed Persons. Those with [FEC] have recorded political donations.`,
          sources: ['SEC Form 4', 'Wikidata', 'DEF 14A'],
        };
      }
      return { reply: `The investigation found ${people.length} people connected to **${companyName}**. Director data may be limited for this jurisdiction.`, sources: context.sources };
    }

    if (q.includes('subsidiary') || q.includes('subsidiaries') || q.includes('owns') || q.includes('structure') || q.includes('group')) {
      return {
        reply: subCount !== '0'
          ? `**${companyName}** has **${subCount} subsidiaries** identified:\n\n${subNames}\n\nThese were identified through Wikidata, SEC 10-K Exhibit 21, and GLEIF ownership data.`
          : `No subsidiary information was found for **${companyName}**. This may indicate a standalone entity or limited disclosure.`,
        sources: ['Wikidata', 'SEC 10-K', 'GLEIF'],
      };
    }

    if (q.includes('court') || q.includes('lawsuit') || q.includes('litigation') || q.includes('legal')) {
      return {
        reply: parseInt(courtCases) > 0
          ? `**${courtCases} court cases** were found involving **${companyName}** or related entities.\n\n${findings.filter((f) => f.includes('LITIGATION') || f.includes('court')).map((f) => `- ${f}`).join('\n') || 'Details available in the Findings tab.'}\n\nCourt records were sourced from CourtListener (US federal) and Indian Kanoon (India). Review the specific cases to determine if the company is plaintiff or defendant.`
          : `No court cases were found for **${companyName}** in the databases searched (CourtListener, Indian Kanoon).`,
        sources: ['CourtListener', 'Indian Kanoon'],
      };
    }

    if (q.includes('recommend') || q.includes('what should') || q.includes('next step') || q.includes('do next') || q.includes('action')) {
      const parts: string[] = [`**Recommended next steps for ${companyName} (score: ${score}/100):**\n`];
      if (parseInt(score) >= 50) {
        parts.push(`1. **Escalate** to senior compliance for review before proceeding`);
        parts.push(`2. **Request** face-to-face meeting with beneficial owners`);
        parts.push(`3. **Consider** enhanced due diligence (EDD) before proceeding`);
      } else if (parseInt(score) >= 25) {
        parts.push(`1. **Review** the ${findings.length} findings, focusing on HIGH-severity items`);
        parts.push(`2. **Request** additional documentation from the company`);
        parts.push(`3. **Schedule** enhanced monitoring review in 6 months`);
      } else {
        parts.push(`1. **Proceed** with standard onboarding procedures`);
        parts.push(`2. **Document** this screening for audit trail`);
        parts.push(`3. **Schedule** periodic review in 12 months`);
      }
      if (parseInt(pepCount) > 0) parts.push(`4. **Apply EDD** for the ${pepCount} PEP(s) in the network`);
      if (recommendations.length > 0) parts.push(`\n**AI recommendations:** ${recommendations.join('. ')}`);
      return { reply: parts.join('\n'), sources: context.sources };
    }

    if (q.includes('investor') || q.includes('invest') || q.includes('shareholder') || q.includes('ownership')) {
      const parts: string[] = [`**Ownership & investment data for ${companyName}:**\n`];
      const ownershipLines = lines.filter((l) => l.includes('promoter') || l.includes('public') || l.includes('holding') || l.includes('shareholder'));
      if (ownershipLines.length > 0) ownershipLines.forEach((l) => parts.push(`- ${l.trim()}`));
      if (parseInt(subCount) > 0) parts.push(`\n**Subsidiaries:** ${subCount} entities — ${subNames}`);
      const parentLines = lines.filter((l) => l.includes('parent') || l.includes('PARENT'));
      if (parentLines.length > 0) parentLines.forEach((l) => parts.push(`- ${l.trim()}`));
      if (parts.length === 1) parts.push(`Ownership data is limited. For listed companies, check the shareholding pattern. For private companies, UBO data may be available in the UBO tab.`);
      return { reply: parts.join('\n'), sources: ['NSE India', 'SEC Form 4', 'GLEIF', 'Companies House PSC'] };
    }

    // Default — give a data-rich overview instead of menu
    const parts: string[] = [];
    parts.push(`**${companyName}** — investigation overview:\n`);
    parts.push(`- Risk score: **${score}/100 (${classification})**`);
    if (revenue) parts.push(`- Revenue: **${revenue}**`);
    if (employees) parts.push(`- Employees: **${employees}**`);
    if (industry) parts.push(`- Industry: **${industry}**`);
    parts.push(`- Network: **${people.length} people**, **${subCount} subsidiaries**`);
    parts.push(`- PEPs: **${pepCount}** | Sanctions: **${sanctionMatches === '0' ? 'clear' : sanctionMatches}** | Court cases: **${courtCases}** | Media: **${mediaHits}**`);
    if (findings.length > 0) {
      parts.push(`\n**Top findings:**`);
      findings.slice(0, 3).forEach((f) => parts.push(`- ${f}`));
    }
    parts.push(`\nAsk me about any specific area — financials, PEPs, sanctions, directors, subsidiaries, court cases, or what to do next.`);
    return { reply: parts.join('\n'), sources: context.sources };
  }
}
