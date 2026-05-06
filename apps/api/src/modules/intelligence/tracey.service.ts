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

const TRACEY_SYSTEM_PROMPT = `You are Tracey, a senior M&A due diligence analyst at a boutique advisory firm. You talk like a sharp, experienced colleague who has personally reviewed the target's full DD file and is now briefing the deal team.

HOW YOU TALK:
- Natural and direct — like a trusted advisor, not a compliance scanner
- Lead with the deal implication, not the raw data. Say "The Luxembourg structure would complicate a share purchase — legal needs to map the liabilities first" not "Finding #3: FATF greylist jurisdiction detected"
- Use specific names, numbers, and dates from the data. Never be vague when you have specifics.
- When you don't have data: "We don't have that in the file. You'd want to get it from [source] before closing."
- Explain WHY it matters for the deal: "Three dissolved companies under the founder means you'll want personal warranties in the SPA, not just corporate reps"
- You can be opinionated: "Honestly, the PEP flag looks routine for someone with government board seats — but you'll still need enhanced KYC before the LP call" or "This is the part that would make me pause the LOI"

STRICT RULES:
- ONLY use data from the INVESTIGATION CONTEXT provided. Never fabricate.
- If asked about anything non-deal-related: "I'm focused on this DD file right now. What aspect of [company] should we dig into?"
- Address the user by name if provided in the context.

RESPONSE FORMAT:
End every response with exactly 3 follow-up suggestions on a NEW line starting with "FOLLOWUPS:" separated by "|".
- Make them specific to THIS company's data, not generic
- Mix: 1 deeper follow-up on current topic, 1 new unexplored area, 1 action-oriented (e.g. "Flag for legal", "Add to deal memo")
- Under 8 words each
Example: FOLLOWUPS: Map the Luxembourg subsidiary chain|Check the founder's previous exits|Flag the PEP for legal review`;

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
    userName?: string,
  ): Promise<{ reply: string; sources: string[]; followUps: string[] }> {
    // Build investigation context
    const context = await this.buildContext(investigationId);
    if (!context) {
      return { reply: "I can't find this investigation. It may still be processing — please check back once it's complete.", sources: [], followUps: [] };
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    this.logger.log(`Tracey using key: ${apiKey ? apiKey.slice(0, 15) + '...' : 'NONE'}, model: ${model}`);

    if (!apiKey) {
      return this.fallbackResponse(question, context);
    }

    // Build messages
    const userCtx = userName ? `\nUSER: The person asking is "${userName}". Address them by first name occasionally.` : '';
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: TRACEY_SYSTEM_PROMPT },
      { role: 'system', content: `INVESTIGATION CONTEXT:\n${context.briefing}${userCtx}` },
      ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: question },
    ];

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model, messages, temperature: 0.4, max_tokens: 500 },
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

      const raw = res.data?.choices?.[0]?.message?.content || "I'm having trouble processing that. Could you rephrase your question?";

      // Separate thinking from answer
      let cleaned = raw;
      let thinking = '';

      // Handle <think>...</think> blocks
      const thinkMatch = cleaned.match(/<think>([\s\S]*?)<\/think>/i);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      }

      // Handle models that dump thinking as plain text before the answer
      if (/^(Okay|Alright|Hmm|Let me think|Looking at|I notice|The user|Wait,)/i.test(cleaned)) {
        const paragraphs = cleaned.split('\n\n');
        const answerStart = paragraphs.findIndex((p: string) =>
          /^(Hey|Hi |Based|Here|The investigation|Your |So,|Great|#{1,3} |\*\*|Anmol)/i.test(p.trim())
        );
        if (answerStart > 0) {
          thinking = paragraphs.slice(0, answerStart).join('\n\n');
          cleaned = paragraphs.slice(answerStart).join('\n\n');
        }
      }

      // Prefix thinking as a collapsible section if present
      if (thinking && cleaned.length > 30) {
        cleaned = `<thinking>${thinking}</thinking>\n\n${cleaned}`;
      }

      // Parse follow-ups from response
      let reply = cleaned;
      let followUps: string[] = [];
      const followUpMatch = cleaned.match(/FOLLOWUPS:\s*(.+)$/im);
      if (followUpMatch) {
        reply = cleaned.replace(/\n?FOLLOWUPS:.+$/im, '').trim();
        followUps = followUpMatch[1].split('|').map((s: string) => s.trim()).filter((s: string) => s.length > 3 && s.length < 60).slice(0, 4);
      }

      return { reply, sources: context.sources, followUps };
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
      lines.push(`SUBSIDIARIES (${subsidiaries.length}): ${subsidiaries.slice(0, 8).map((s) => {
        const sm = s.metadata as any;
        return `${s.label}${sm?.jurisdiction ? ' ('+sm.jurisdiction+')' : ''}`;
      }).join(', ')}${subsidiaries.length > 8 ? ` ...+${subsidiaries.length - 8} more` : ''}`);
      sources.push('Wikidata / SEC 10-K');
    }

    // Addresses / Locations
    if (addresses.length > 0) {
      lines.push(`LOCATIONS (${addresses.length}): ${addresses.slice(0, 5).map((a) => {
        const am = a.metadata as any;
        return `${a.label}: ${am?.raw?.address || 'unknown'}`;
      }).join('; ')}`);
      sources.push('SEC EDGAR / Nominatim');
    }

    // Key people (compact)
    const keyPeople = people.slice(0, 10).map((p) => {
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

    // Domain profile (web-sourced investigations)
    const dp = progress.domainProfile;
    if (dp) {
      lines.push(`\n=== WEB-SOURCED COMPANY INTELLIGENCE ===`);
      lines.push(`DOMAIN: ${dp.domain}`);
      if (dp.description) lines.push(`DESCRIPTION: ${dp.description}`);
      if (dp.tagline) lines.push(`TAGLINE: ${dp.tagline}`);
      if (dp.industry) lines.push(`INDUSTRY: ${dp.industry}`);
      if (dp.location) lines.push(`LOCATION: ${dp.location}`);
      if (dp.foundedYear) lines.push(`FOUNDED: ${dp.foundedYear}`);
      if (dp.employeeCount) lines.push(`EMPLOYEES: ${dp.employeeCount}`);
      if (dp.totalFundingAmount) lines.push(`TOTAL FUNDING: ${dp.totalFundingAmount}`);

      if (dp.founderDetails?.length > 0) {
        lines.push(`\nFOUNDERS (${dp.founderDetails.length}):`);
        for (const f of dp.founderDetails) {
          lines.push(`- ${f.name} (${f.title || 'Founder'})${f.background ? ': ' + f.background : ''}`);
        }
      } else if (dp.founders?.length > 0) {
        lines.push(`FOUNDERS: ${dp.founders.join(', ')}`);
      }

      if (dp.investors?.length > 0) lines.push(`INVESTORS: ${dp.investors.slice(0, 8).join(', ')}`);

      if (dp.fundingRounds?.length > 0) {
        lines.push(`\nFUNDING ROUNDS:`);
        for (const r of dp.fundingRounds) {
          lines.push(`- ${r.type || 'Round'}: ${r.amount || 'undisclosed'} (${r.date || 'undated'}) — Source: ${r.source}${r.investors?.length > 0 ? ' — Investors: ' + r.investors.join(', ') : ''}`);
        }
      }

      if (dp.github) {
        lines.push(`\nGITHUB: ${dp.github.orgName || 'found'} — ${dp.github.repos} repos, ${dp.github.stars} stars, tech: ${(dp.github.topLanguages || []).join(', ')}`);
      }

      if (dp.news?.length > 0) {
        lines.push(`\nRECENT NEWS: ${dp.news.slice(0, 3).map((n: any) => n.title).join(' | ')}`);
      }

      if (dp.hnMentions?.length > 0) {
        lines.push(`HN MENTIONS: ${dp.hnMentions.slice(0, 2).map((h: any) => `"${h.title}" (${h.points} pts)`).join(' | ')}`);
      }

      if (dp.formDFilings > 0) lines.push(`SEC FORM D: ${dp.formDFilings} US private placement filing(s)`);
      lines.push(`\nDATA SOURCES: ${(dp.sources || []).join(', ')}`);
      lines.push(`NOTE: No public registry record found. All intelligence from web sources.`);
      sources.push('Website / Crunchbase / GitHub / HackerNews / News');
    }

    // Capital / Funding history
    const fe = progress.fundingEvents;
    if (fe?.equityRaises > 0) {
      const totalGBP = fe.totalRaisedMinor > 0 ? `£${(fe.totalRaisedMinor / 100 / 1_000_000).toFixed(2)}M` : 'amount undisclosed';
      lines.push(`\nCAPITAL HISTORY: ${fe.equityRaises} equity raise(s) detected totalling ${totalGBP} (${fe.currency})`);
      if (fe.latestRaise?.date) lines.push(`  Latest: ${fe.latestRaise.date}${fe.latestRaise.shareClass ? ' (' + fe.latestRaise.shareClass + ')' : ''}`);
      sources.push('Companies House SH01 / SEC Form D');
    }

    // Wayback
    if (progress.wayback?.firstSnapshot) {
      lines.push(`\nWEB PRESENCE: Online since ${progress.wayback.firstSnapshot} (${progress.wayback.domainAgeYears} years)`);
      sources.push('Wayback Machine');
    }

    // Findings (compact — title only, top 5)
    const findings = progress.findings || [];
    if (findings.length > 0) {
      const top = findings.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 5);
      lines.push(`\nFINDINGS (${findings.length} total, ${top.length} critical/high): ${top.map((f: any) => `[${f.severity}] ${f.title}`).join('; ')}`);
    }

    // Narrative (summary only)
    if (progress.narrative?.executiveSummary) {
      lines.push(`\nNARRATIVE: ${progress.narrative.executiveSummary.slice(0, 200)}`);
      if (progress.narrative.pepWarnings?.length > 0) {
        lines.push(`PEP DETAIL: ${progress.narrative.pepWarnings.join('; ')}`);
      }
    }

    return { briefing: lines.join('\n'), sources: [...new Set(sources)] };
  }

  /** Data-driven fallback when LLM is unavailable */
  private fallbackResponse(question: string, context: { briefing: string; sources: string[] }): { reply: string; sources: string[]; followUps: string[] } {
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
      return { reply: parts.join('\n'), sources: context.sources, followUps: [] };
    }

    if (q.includes('risk') || q.includes('score') || q.includes('safe') || q.includes('proceed')) {
      let reply = `**${companyName}** has a risk score of **${score}/100 (${classification})**.`;
      if (parseInt(score) >= 50) reply += ` This is an elevated risk profile — enhanced due diligence is recommended before proceeding.`;
      else if (parseInt(score) >= 25) reply += ` This is a moderate risk profile — review the HIGH-severity findings before proceeding.`;
      else reply += ` This is a low-risk profile — standard due diligence procedures are sufficient.`;
      reply += `\n\nThe score is based on ${findings.length} findings across ${context.sources.length} data sources.`;
      if (narrative) reply += `\n\n${narrative}`;
      return { reply, sources: context.sources, followUps: [] };
    }

    if (q.includes('pep') || q.includes('political') || q.includes('exposed')) {
      if (parseInt(pepCount) > 0) {
        let reply = `**${pepCount} Politically Exposed Person(s)** detected:\n`;
        people.filter((p) => p.includes('[PEP')).forEach((p) => { reply += `\n- ${p}`; });
        if (pepWarnings.length > 0) reply += `\n\n**Details:** ${pepWarnings.join('. ')}`;
        reply += `\n\nPEPs require enhanced due diligence (EDD) under AML regulations. You need to verify the source of funds and document the business rationale.`;
        return { reply, sources: ['Wikidata P39'] , followUps: [] };
      }
      return { reply: `No Politically Exposed Persons were detected among the ${people.length} people in **${companyName}**'s network. The investigation screened all individuals against Wikidata's political positions database.`, sources: ['Wikidata P39'], followUps: [] };
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
        followUps: [],
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
      return { reply: parts.join('\n'), sources: ['SEC XBRL', 'NSE India', 'Wikidata'], followUps: [] };
    }

    if (q.includes('director') || q.includes('officer') || q.includes('people') || q.includes('who') || q.includes('board') || q.includes('team')) {
      if (people.length > 0) {
        return {
          reply: `**Key people in ${companyName}'s network (${people.length}):**\n\n${people.slice(0, 10).map((p) => `- ${p}`).join('\n')}${people.length > 10 ? `\n- ...and ${people.length - 10} more` : ''}\n\nPeople flagged with [PEP] are Politically Exposed Persons. Those with [FEC] have recorded political donations.`,
          sources: ['SEC Form 4', 'Wikidata', 'DEF 14A'],
          followUps: [],
        };
      }
      return { reply: `The investigation found ${people.length} people connected to **${companyName}**. Director data may be limited for this jurisdiction.`, sources: context.sources, followUps: [] };
    }

    if (q.includes('subsidiary') || q.includes('subsidiaries') || q.includes('owns') || q.includes('structure') || q.includes('group')) {
      return {
        reply: subCount !== '0'
          ? `**${companyName}** has **${subCount} subsidiaries** identified:\n\n${subNames}\n\nThese were identified through Wikidata, SEC 10-K Exhibit 21, and GLEIF ownership data.`
          : `No subsidiary information was found for **${companyName}**. This may indicate a standalone entity or limited disclosure.`,
        sources: ['Wikidata', 'SEC 10-K', 'GLEIF'],
        followUps: [],
      };
    }

    if (q.includes('court') || q.includes('lawsuit') || q.includes('litigation') || q.includes('legal')) {
      return {
        reply: parseInt(courtCases) > 0
          ? `**${courtCases} court cases** were found involving **${companyName}** or related entities.\n\n${findings.filter((f) => f.includes('LITIGATION') || f.includes('court')).map((f) => `- ${f}`).join('\n') || 'Details available in the Findings tab.'}\n\nCourt records were sourced from CourtListener (US federal) and Indian Kanoon (India). Review the specific cases to determine if the company is plaintiff or defendant.`
          : `No court cases were found for **${companyName}** in the databases searched (CourtListener, Indian Kanoon).`,
        sources: ['CourtListener', 'Indian Kanoon'],
        followUps: [],
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
      return { reply: parts.join('\n'), sources: context.sources, followUps: [] };
    }

    if (q.includes('investor') || q.includes('invest') || q.includes('shareholder') || q.includes('ownership')) {
      const parts: string[] = [`**Ownership & investment data for ${companyName}:**\n`];
      const ownershipLines = lines.filter((l) => l.includes('promoter') || l.includes('public') || l.includes('holding') || l.includes('shareholder'));
      if (ownershipLines.length > 0) ownershipLines.forEach((l) => parts.push(`- ${l.trim()}`));
      if (parseInt(subCount) > 0) parts.push(`\n**Subsidiaries:** ${subCount} entities — ${subNames}`);
      const parentLines = lines.filter((l) => l.includes('parent') || l.includes('PARENT'));
      if (parentLines.length > 0) parentLines.forEach((l) => parts.push(`- ${l.trim()}`));
      if (parts.length === 1) parts.push(`Ownership data is limited. For listed companies, check the shareholding pattern. For private companies, UBO data may be available in the UBO tab.`);
      return { reply: parts.join('\n'), sources: ['NSE India', 'SEC Form 4', 'GLEIF', 'Companies House PSC'], followUps: [] };
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
    return { reply: parts.join('\n'), sources: context.sources, followUps: [] };
  }
}
