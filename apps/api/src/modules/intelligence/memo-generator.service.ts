import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Investigation } from '../investigation/entities/investigation.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';

export interface InvestigationMemo {
  generatedAt: string;
  companyName: string;
  riskScore: number;
  executiveSummary: string;
  targetOverview: {
    industry: string;
    founded: string;
    scale: string;
    footprint: string;
    description: string;
  };
  ownershipControl: {
    summary: string;
    complexityRating: 'SIMPLE' | 'MODERATE' | 'COMPLEX' | 'OPAQUE';
    keyPoints: string[];
  };
  keyPeople: Array<{
    name: string;
    role: string;
    trackRecord: string;
    flags: string[];
  }>;
  riskProfile: {
    dealBlockers: string[];
    yellowFlags: string[];
    cleanSignals: string[];
  };
  financialSnapshot: {
    summary: string;
    available: boolean;
  };
  recommendation: 'PROCEED' | 'CONDITIONS' | 'WALK';
  recommendationRationale: string;
  nextStepDDScope: string[];
  userOverrides?: Record<string, string>;
}

const MEMO_SYSTEM_PROMPT = `You are a senior M&A due diligence analyst. Generate a structured acquisition memo in JSON format based on the investigation data provided.

The memo must follow this exact JSON structure — respond ONLY with valid JSON, no prose before or after:

{
  "executiveSummary": "3-5 sentence summary of the target and overall deal stance",
  "targetOverview": {
    "industry": "sector/industry classification",
    "founded": "founding year or date",
    "scale": "employee count and revenue summary (e.g. ~200 employees, £15M revenue)",
    "footprint": "geographic presence and subsidiary count",
    "description": "2-3 sentence business description"
  },
  "ownershipControl": {
    "summary": "2-3 sentence summary of ownership and control structure",
    "complexityRating": "SIMPLE | MODERATE | COMPLEX | OPAQUE",
    "keyPoints": ["point 1", "point 2", "point 3"]
  },
  "keyPeople": [
    {
      "name": "full name",
      "role": "title/role",
      "trackRecord": "1-2 sentence summary of history and relevant experience",
      "flags": ["PEP", "SANCTIONED", "DISSOLVED_HISTORY"] or []
    }
  ],
  "riskProfile": {
    "dealBlockers": ["specific deal-blocking risks with evidence"],
    "yellowFlags": ["items requiring further investigation"],
    "cleanSignals": ["positive indicators"]
  },
  "financialSnapshot": {
    "summary": "summary of available financial data, or 'No public financial data available for this entity'",
    "available": true or false
  },
  "recommendation": "PROCEED | CONDITIONS | WALK",
  "recommendationRationale": "2-3 sentences explaining the recommendation",
  "nextStepDDScope": ["specific next-step items for legal, financial, technical, or operational DD"]
}

RULES:
- Base every claim strictly on the investigation data provided
- dealBlockers = sanctions hits, known fraud, disqualified directors, opaque offshore ownership — things that stop a deal
- yellowFlags = things needing verification but not automatically blocking
- cleanSignals = positive indicators (clean sanctions, long tenure, audited accounts, active GitHub, named investors, job growth)
- recommendation: PROCEED (low risk, clean signals), CONDITIONS (manageable risks needing mitigation), WALK (deal-blocking risks present)
- nextStepDDScope must be specific and actionable — for web-sourced companies where data is limited, generate specific REQUEST items (e.g. "Request signed cap table", "Request incorporation certificate", "Schedule technical reference call with CTO")
- If this is a web-sourced investigation with no registry data: be explicit that this is based on public web intelligence only, and make the nextStepDDScope a comprehensive list of what must be obtained before any capital commitment
- Never leave a section blank — if data is unavailable, explain what's missing and why it matters`;

@Injectable()
export class MemoGeneratorService {
  private readonly logger = new Logger(MemoGeneratorService.name);

  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async generate(investigationId: string): Promise<InvestigationMemo> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    if (!inv || inv.status !== 'COMPLETE') {
      throw new Error('Investigation not complete or not found');
    }

    const context = await this.buildMemoContext(inv);
    const memo = await this.callLlm(context, inv);

    // Persist via save() — mutate the loaded entity in-place
    inv.progress = { ...(inv.progress || {}), memo } as any;
    await this.investigations.save(inv);

    return memo;
  }

  async getMemo(investigationId: string): Promise<InvestigationMemo | null> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    return (inv?.progress as any)?.memo || null;
  }

  async saveUserEdits(investigationId: string, overrides: Record<string, string>): Promise<void> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    if (!inv || !(inv.progress as any)?.memo) return;
    const updatedMemo = {
      ...(inv.progress as any).memo,
      userOverrides: overrides,
      lastEditedAt: new Date().toISOString(),
    };
    inv.progress = { ...(inv.progress || {}), memo: updatedMemo } as any;
    await this.investigations.save(inv);
  }

  private async buildMemoContext(inv: Investigation): Promise<string> {
    const nodes = await this.nodes.find({ where: { investigationId: inv.id } });
    const companies = nodes.filter((n) => n.entityType === 'company');
    const people = nodes.filter((n) => n.entityType === 'person');
    const addresses = nodes.filter((n) => n.entityType === 'address');
    const progress = inv.progress || {} as any;
    const rootMeta = companies.find((c) => (c.metadata as any)?.enriched)?.metadata as any || {};

    const lines: string[] = [];
    const companyName = inv.metadata?.companyName || inv.query;

    lines.push(`=== ACQUISITION TARGET DD FILE ===`);
    lines.push(`COMPANY: ${companyName}`);
    lines.push(`JURISDICTION: ${inv.metadata?.jurisdiction || 'Unknown'}`);
    lines.push(`DEAL RISK SCORE: ${progress.riskScore ?? 0}/100 (${progress.riskClassification || 'LOW'})`);

    // ── Web-sourced domain profile (for startups without registry data) ───
    const dp = progress.domainProfile;
    if (dp) {
      lines.push(`\n=== WEB-SOURCED INTELLIGENCE (no public registry record) ===`);
      if (dp.description) lines.push(`DESCRIPTION: ${dp.description}`);
      if (dp.tagline) lines.push(`TAGLINE: "${dp.tagline}"`);
      if (dp.industry) lines.push(`INDUSTRY: ${dp.industry}`);
      if (dp.location) lines.push(`LOCATION: ${dp.location}`);
      if (dp.foundedYear) lines.push(`FOUNDED: ${dp.foundedYear}`);
      if (dp.employeeCount) lines.push(`EMPLOYEES: ${dp.employeeCount} (LinkedIn/web estimate)`);
      if (dp.totalFundingAmount) lines.push(`TOTAL FUNDING: ${dp.totalFundingAmount}`);

      if (dp.founderDetails?.length > 0) {
        lines.push(`\nFOUNDERS:`);
        for (const f of dp.founderDetails) {
          lines.push(`- ${f.name} (${f.title || 'Founder'})${f.background ? ': ' + f.background : ''}`);
          if (f.hnPosts?.length > 0) lines.push(`  HN activity: ${f.hnPosts.map((h: any) => `"${h.title}" (${h.points}pts)`).join(', ')}`);
          if (f.newsHits?.length > 0) lines.push(`  Press: ${f.newsHits.map((n: any) => n.title).join(', ')}`);
          if (f.githubActivity) lines.push(`  GitHub: ${f.githubActivity}`);
        }
      } else if (dp.founders?.length > 0) {
        lines.push(`FOUNDERS: ${dp.founders.join(', ')}`);
      } else {
        lines.push(`FOUNDERS: Not publicly identified`);
      }

      if (dp.investors?.length > 0) lines.push(`\nINVESTORS (public sources): ${dp.investors.join(', ')}`);
      else lines.push(`INVESTORS: None identified from public sources`);

      if (dp.fundingRounds?.length > 0) {
        lines.push(`\nFUNDING ROUNDS:`);
        for (const r of dp.fundingRounds) {
          lines.push(`- ${r.type || 'Round'}: ${r.amount || 'undisclosed'} (${r.date || 'undated'}) [source: ${r.source}]${r.investors?.length > 0 ? ' — ' + r.investors.join(', ') : ''}`);
        }
      } else {
        lines.push(`FUNDING ROUNDS: None confirmed from public sources`);
      }

      if (dp.techStack) {
        const ts = dp.techStack;
        const techParts = [`Hosting: ${ts.hosting?.join(', ') || 'unknown'}`, `Frontend: ${ts.frontend?.join(', ') || 'unknown'}`];
        if (ts.payments?.length > 0) techParts.push(`Payments: ${ts.payments.join(', ')}`);
        if (ts.analytics?.length > 0) techParts.push(`Analytics: ${ts.analytics.join(', ')}`);
        lines.push(`\nTECH STACK: ${techParts.join(' | ')}`);
      }

      if (dp.github) {
        lines.push(`GITHUB: ${dp.github.orgName} — ${dp.github.repos} repos, ${dp.github.stars} stars, tech: ${dp.github.topLanguages?.join(', ') || 'unknown'}`);
        if (dp.github.topRepos?.length > 0) {
          lines.push(`Top repos: ${dp.github.topRepos.map((r: any) => `${r.name} (${r.stars}★)`).join(', ')}`);
        }
      } else {
        lines.push(`GITHUB: No public GitHub organisation found`);
      }

      if (dp.openRoleCount > 0) {
        lines.push(`\nOPEN ROLES: ${dp.openRoleCount} active job postings`);
        const byDept: Record<string, number> = {};
        for (const j of (dp.jobPostings || [])) byDept[j.department] = (byDept[j.department] || 0) + 1;
        lines.push(`By department: ${Object.entries(byDept).map(([d, c]) => `${d} (${c})`).join(', ')}`);
      } else {
        lines.push(`OPEN ROLES: No public job postings found`);
      }

      if (dp.productHunt?.found) {
        lines.push(`\nPRODUCT HUNT: "${dp.productHunt.name}" — ${dp.productHunt.upvotes} upvotes, ${dp.productHunt.reviews} comments, launched ${dp.productHunt.launchDate || 'unknown'}`);
      } else {
        lines.push(`PRODUCT HUNT: Not launched on ProductHunt`);
      }

      if (dp.news?.length > 0) {
        lines.push(`\nPRESS COVERAGE: ${dp.news.length} articles found`);
        dp.news.slice(0, 4).forEach((n: any) => lines.push(`- "${n.title}" (${n.source}, ${n.date})`));
      } else {
        lines.push(`PRESS COVERAGE: No news coverage found`);
      }

      if (dp.hnMentions?.length > 0) {
        lines.push(`HN MENTIONS: ${dp.hnMentions.map((h: any) => `"${h.title}" (${h.points}pts, ${h.comments} comments)`).join(' | ')}`);
      }

      if (dp.ddQuestions?.length > 0) {
        lines.push(`\nCRITICAL DD GAPS (must resolve before commitment):`);
        dp.ddQuestions.forEach((q: string) => lines.push(`- ${q}`));
      }

      lines.push(`\nDATA SOURCES USED: ${dp.sources?.join(', ') || 'website only'}`);
      lines.push(`NOTE: This is a web-only investigation. No public corporate registry record exists.`);
    }

    // Profile (registry investigations)
    if (!dp) {
      if (rootMeta.revenue) lines.push(`REVENUE: ${rootMeta.revenue}`);
      if (rootMeta.employeeCount) lines.push(`EMPLOYEES: ${rootMeta.employeeCount}`);
      if (rootMeta.industry) lines.push(`INDUSTRY: ${rootMeta.industry}`);
      if (rootMeta.website) lines.push(`WEBSITE: ${rootMeta.website}`);
      if (rootMeta.foundedDate) lines.push(`FOUNDED: ${rootMeta.foundedDate}`);
      if (rootMeta.companyType) lines.push(`COMPANY TYPE: ${rootMeta.companyType}`);
    }

    // Network
    lines.push(`\nNETWORK SIZE: ${companies.length} companies, ${people.length} people, ${addresses.length} addresses`);
    const subsidiaries = companies.filter((c) => (c.metadata as any)?.isSubsidiary);
    if (subsidiaries.length > 0) {
      lines.push(`SUBSIDIARIES (${subsidiaries.length}): ${subsidiaries.slice(0, 10).map((s) => {
        const sm = s.metadata as any;
        return `${s.label}${sm?.jurisdiction ? ' (' + sm.jurisdiction + ')' : ''}`;
      }).join(', ')}`);
    }

    // Addresses
    const flaggedAddresses = addresses.filter((a) => {
      const am = a.metadata as any;
      return am?.classification === 'VIRTUAL_OFFICE' || am?.classification === 'FORMATION_AGENT';
    });
    if (flaggedAddresses.length > 0) {
      lines.push(`FLAGGED ADDRESSES (${flaggedAddresses.length}): ${flaggedAddresses.slice(0, 3).map((a) => {
        const am = a.metadata as any;
        return `${a.label} [${am?.classification}]`;
      }).join('; ')}`);
    }

    // UBO chains
    const uboChains: any[] = progress.uboChains || [];
    if (uboChains.length > 0) {
      lines.push(`\nOWNERSHIP CHAINS (${uboChains.length}):`);
      uboChains.slice(0, 3).forEach((chain: any, i: number) => {
        const steps = (chain.links || []).map((l: any) => l.label || l.name || 'Unknown').join(' → ');
        lines.push(`Chain ${i + 1}: ${steps}`);
      });
    }

    // Key people
    const keyPeople = people.slice(0, 12);
    if (keyPeople.length > 0) {
      lines.push(`\nKEY PEOPLE:`);
      keyPeople.forEach((p) => {
        const m = p.metadata as any;
        const flags: string[] = [];
        if (m?.isPep) flags.push('PEP');
        if (m?.sanctionsHit) flags.push('SANCTIONED');
        if (m?.isDisqualified) flags.push('DISQUALIFIED_DIRECTOR');
        if (m?.directorRisk?.dissolvedCount > 2) flags.push(`${m.directorRisk.dissolvedCount} DISSOLVED_COMPANIES`);
        const appCount = m?.appointmentCount || 1;
        lines.push(`- ${p.label} (${m?.role || 'Officer'}): ${appCount} directorships${flags.length ? ' | FLAGS: ' + flags.join(', ') : ''}`);
      });
    }

    // Financials
    const fin = progress.secIntelligence?.financials;
    if (fin) {
      lines.push(`\nFINANCIAL DATA (SEC XBRL):`);
      if (fin.profitMargin != null) lines.push(`- Profit margin: ${fin.profitMargin}%`);
      if (fin.debtToEquity != null) lines.push(`- Debt/equity ratio: ${fin.debtToEquity}`);
      if (fin.currentRatio != null) lines.push(`- Current ratio: ${fin.currentRatio}`);
      if (fin.flags?.length > 0) lines.push(`- Financial flags: ${fin.flags.join(', ')}`);
    } else {
      lines.push(`\nFINANCIAL DATA: Not available (private company / non-SEC filer)`);
    }

    // Capital / Funding history
    const fe = progress.fundingEvents;
    if (fe?.equityRaises > 0) {
      const totalGBP = fe.totalRaisedMinor > 0 ? `£${(fe.totalRaisedMinor / 100 / 1_000_000).toFixed(2)}M` : 'undisclosed';
      lines.push(`\nCAPITAL HISTORY: ${fe.equityRaises} equity raise(s), total ${totalGBP}`);
      if (fe.latestRaise?.date) lines.push(`Latest raise: ${fe.latestRaise.date}${fe.latestRaise.shareClass ? ' — ' + fe.latestRaise.shareClass : ''}`);
    }

    // Compliance signals
    lines.push(`\nCOMPLIANCE SIGNALS:`);
    lines.push(`- PEPs in network: ${progress.pepCount || 0}`);
    lines.push(`- Direct sanctions hits: ${progress.directSanctions?.matches || 0}`);
    lines.push(`- Adverse media hits: ${progress.adverseMediaCount || 0}`);
    lines.push(`- FATF jurisdiction flags: ${progress.fatfFlags || 0}`);
    lines.push(`- Court cases found: ${progress.webIntelligence?.courtCases || 0}`);
    const epa = progress.regulatoryViolations?.epa || 0;
    const osha = progress.regulatoryViolations?.osha || 0;
    if (epa + osha > 0) lines.push(`- Regulatory violations: ${epa + osha} (EPA: ${epa}, OSHA: ${osha})`);

    // Top findings
    const findings: any[] = progress.findings || [];
    const criticalHigh = findings.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
    if (criticalHigh.length > 0) {
      lines.push(`\nHIGH/CRITICAL FINDINGS (${criticalHigh.length}):`);
      criticalHigh.slice(0, 8).forEach((f: any) => {
        lines.push(`- [${f.severity}] ${f.type}: ${f.title}`);
        if (f.description) lines.push(`  ${f.description.slice(0, 200)}`);
      });
    }
    const medium = findings.filter((f: any) => f.severity === 'MEDIUM');
    if (medium.length > 0) {
      lines.push(`\nMEDIUM FINDINGS (${medium.length}): ${medium.slice(0, 5).map((f: any) => f.title).join('; ')}`);
    }

    return lines.join('\n');
  }

  private async callLlm(context: string, inv: Investigation): Promise<InvestigationMemo> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
    const companyName = inv.metadata?.companyName || inv.query;
    const score = inv.progress?.riskScore ?? 0;

    if (!apiKey) {
      return this.fallbackMemo(companyName, score);
    }

    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: MEMO_SYSTEM_PROMPT },
            { role: 'user', content: `Generate an acquisition memo for the following investigation:\n\n${context}` },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://tracegraph.local',
            'X-Title': 'TraceGraph Memo Generator',
          },
          timeout: 60000,
        },
      );

      const raw = res.data?.choices?.[0]?.message?.content || '';
      // Strip markdown code fences if model wraps in ```json
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      return {
        generatedAt: new Date().toISOString(),
        companyName,
        riskScore: score,
        ...parsed,
      } as InvestigationMemo;
    } catch (e: any) {
      this.logger.warn(`Memo LLM failed: ${e?.message}`);
      return this.fallbackMemo(companyName, score);
    }
  }

  private fallbackMemo(companyName: string, score: number): InvestigationMemo {
    const rec: InvestigationMemo['recommendation'] = score >= 75 ? 'WALK' : score >= 50 ? 'CONDITIONS' : 'PROCEED';
    return {
      generatedAt: new Date().toISOString(),
      companyName,
      riskScore: score,
      executiveSummary: `This is an auto-generated memo for ${companyName}. Full AI generation requires an OPENROUTER_API_KEY. Risk score: ${score}/100.`,
      targetOverview: { industry: 'Unknown', founded: 'Unknown', scale: 'Unknown', footprint: 'Unknown', description: 'Please configure OPENROUTER_API_KEY for full memo generation.' },
      ownershipControl: { summary: 'Ownership data available in the Ownership tab.', complexityRating: 'MODERATE', keyPoints: ['Review the Ownership tab for full UBO chain details.'] },
      keyPeople: [],
      riskProfile: { dealBlockers: score >= 75 ? ['High risk score — review findings tab'] : [], yellowFlags: score >= 25 ? ['Review all findings before proceeding'] : [], cleanSignals: score < 25 ? ['Low risk score'] : [] },
      financialSnapshot: { summary: 'Configure API key for financial snapshot.', available: false },
      recommendation: rec,
      recommendationRationale: `Based on risk score of ${score}/100. Configure OPENROUTER_API_KEY for full AI-generated rationale.`,
      nextStepDDScope: ['Review Findings tab for full risk detail', 'Review Ownership tab for UBO chains', 'Run enhanced background checks on key directors'],
    };
  }
}
