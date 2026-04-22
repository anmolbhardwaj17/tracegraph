import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

/** Risk language patterns with severity */
const RISK_PATTERNS: Array<{ pattern: RegExp; label: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' }> = [
  { pattern: /going\s+concern/gi, label: 'Going concern doubt', severity: 'CRITICAL' },
  { pattern: /material\s+weakness(?:es)?\s+in\s+(?:our\s+)?internal\s+control/gi, label: 'Material weakness in internal controls', severity: 'HIGH' },
  { pattern: /restatement\s+of\s+(?:our\s+)?(?:financial|previously)/gi, label: 'Financial restatement', severity: 'HIGH' },
  { pattern: /securities\s+(?:and\s+exchange\s+)?commission\s+(?:investigation|inquiry|subpoena)/gi, label: 'SEC investigation', severity: 'HIGH' },
  { pattern: /department\s+of\s+justice\s+(?:investigation|inquiry|subpoena)/gi, label: 'DOJ investigation', severity: 'HIGH' },
  { pattern: /grand\s+jury\s+(?:investigation|subpoena|indictment)/gi, label: 'Grand jury proceedings', severity: 'CRITICAL' },
  { pattern: /class\s+action\s+(?:lawsuit|litigation|complaint|suit)/gi, label: 'Class action lawsuit', severity: 'HIGH' },
  { pattern: /bankruptcy\s+(?:petition|filing|protection|proceedings)/gi, label: 'Bankruptcy proceedings', severity: 'CRITICAL' },
  { pattern: /default(?:ed)?\s+(?:on|under)\s+(?:our\s+)?(?:debt|loan|credit|covenant)/gi, label: 'Debt default', severity: 'CRITICAL' },
  { pattern: /goodwill\s+impairment/gi, label: 'Goodwill impairment', severity: 'MEDIUM' },
  { pattern: /significant\s+doubt\s+about\s+(?:our|the\s+company)/gi, label: 'Viability doubt', severity: 'CRITICAL' },
  { pattern: /(?:data|security)\s+breach(?:es)?/gi, label: 'Data/security breach', severity: 'HIGH' },
  { pattern: /ransomware|cyber\s*attack/gi, label: 'Cyber attack', severity: 'HIGH' },
  { pattern: /FCPA|Foreign\s+Corrupt\s+Practices/gi, label: 'FCPA concern', severity: 'HIGH' },
  { pattern: /money\s+laundering/gi, label: 'Money laundering concern', severity: 'CRITICAL' },
  { pattern: /sanctions?\s+violation/gi, label: 'Sanctions violation', severity: 'CRITICAL' },
  { pattern: /(?:cease\s+and\s+desist|consent\s+(?:order|decree))/gi, label: 'Regulatory order', severity: 'HIGH' },
  { pattern: /whistle\s*blow/gi, label: 'Whistleblower activity', severity: 'MEDIUM' },
  { pattern: /executive\s+(?:officer|chairman|CEO|CFO)\s+(?:departed|resigned|terminated)/gi, label: 'Senior executive departure', severity: 'MEDIUM' },
];

export interface NlpResult {
  riskLanguage: Array<{ label: string; severity: string; count: number; context: string }>;
  overallSentiment: 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE';
  riskDensity: number; // risk mentions per 1000 words
  findings: Finding[];
}

/**
 * Phase V: NLP Filing Intelligence.
 *
 * Analyzes text from SEC filings (10-K, DEF 14A, 8-K) to detect
 * risk language that indicates serious problems:
 * - "Going concern" = company might fail
 * - "Material weakness" = accounting problems
 * - "SEC investigation" = regulatory trouble
 * - "Class action" = major lawsuit
 * - Year-over-year changes in risk language
 *
 * Works on the filing text already extracted by sec-intelligence.service.ts
 * and stored in root node metadata.
 */
@Injectable()
export class FilingNlpService {
  private readonly logger = new Logger(FilingNlpService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async analyze(investigationId: string): Promise<NlpResult> {
    // Get root company node — filing text is in metadata from SEC intelligence
    const rootNode = await this.nodes.findOne({
      where: { investigationId, entityType: 'company' },
      order: { id: 'ASC' },
    });
    if (!rootNode) return this.emptyResult();

    const meta = (rootNode.metadata || {}) as any;

    // Collect all available text: risk factors, 8-K descriptions, announcements
    const texts: string[] = [];
    if (meta.secIntelligence?.riskFactors?.topRisks) {
      texts.push(...meta.secIntelligence.riskFactors.topRisks);
    }
    if (meta.nseData?.announcements) {
      texts.push(...meta.nseData.announcements.map((a: any) => a.subject || ''));
    }

    // Also check findings for filing-related content
    const inv = await this.nodes.manager.query(
      `SELECT progress FROM investigations WHERE id = $1`, [investigationId],
    ).catch(() => []);
    const progress = inv[0]?.progress || {};
    const existingFindings = progress.findings || [];
    for (const f of existingFindings) {
      if (f.evidence) texts.push(...f.evidence.filter((e: string) => e.length > 20));
      if (f.description) texts.push(f.description);
    }

    const fullText = texts.join(' ').toLowerCase();
    if (fullText.length < 100) {
      this.logger.log('NLP: insufficient text for analysis');
      return this.emptyResult();
    }

    this.logger.log(`NLP analysis: ${fullText.length} chars of text`);

    // Run risk pattern detection
    const riskLanguage: NlpResult['riskLanguage'] = [];
    for (const { pattern, label, severity } of RISK_PATTERNS) {
      const matches = fullText.match(pattern);
      if (matches && matches.length > 0) {
        // Extract context around the first match
        const idx = fullText.search(pattern);
        const context = fullText.slice(Math.max(0, idx - 50), idx + 100).replace(/\s+/g, ' ').trim();
        riskLanguage.push({ label, severity, count: matches.length, context: `...${context}...` });
      }
    }

    // Risk density
    const wordCount = fullText.split(/\s+/).length;
    const totalRiskMentions = riskLanguage.reduce((s, r) => s + r.count, 0);
    const riskDensity = Math.round((totalRiskMentions / Math.max(wordCount, 1)) * 1000 * 10) / 10;

    // Overall sentiment
    const criticalCount = riskLanguage.filter((r) => r.severity === 'CRITICAL').length;
    const highCount = riskLanguage.filter((r) => r.severity === 'HIGH').length;
    const overallSentiment: NlpResult['overallSentiment'] =
      criticalCount > 0 ? 'NEGATIVE' : highCount > 2 ? 'NEGATIVE' : highCount > 0 ? 'NEUTRAL' : 'POSITIVE';

    // Update node metadata
    meta.nlpAnalysis = {
      riskLanguageCount: riskLanguage.length,
      criticalLanguage: riskLanguage.filter((r) => r.severity === 'CRITICAL').map((r) => r.label),
      riskDensity,
      sentiment: overallSentiment,
      analyzedAt: new Date().toISOString(),
    };
    await this.nodes.update(rootNode.id, { metadata: meta }).catch(() => {});

    const findings = this.generateFindings(rootNode.label, riskLanguage, overallSentiment, riskDensity);

    this.logger.log(`NLP complete: ${riskLanguage.length} risk patterns, density ${riskDensity}/1000w, sentiment ${overallSentiment}`);

    return { riskLanguage, overallSentiment, riskDensity, findings };
  }

  private generateFindings(
    companyName: string,
    riskLanguage: NlpResult['riskLanguage'],
    sentiment: string,
    density: number,
  ): Finding[] {
    const findings: Finding[] = [];

    const critical = riskLanguage.filter((r) => r.severity === 'CRITICAL');
    if (critical.length > 0) {
      findings.push({
        type: 'CRITICAL_FILING_LANGUAGE',
        severity: 'CRITICAL',
        confidence: 'HIGH',
        title: `Critical risk language detected in filings: ${critical.map((c) => c.label).join(', ')}`,
        description: `NLP analysis of ${companyName}'s filings detected ${critical.length} critical risk pattern(s): ${critical.map((c) => `"${c.label}" (${c.count}x)`).join(', ')}. These indicate serious corporate issues that require immediate attention.`,
        evidence: critical.map((c) => `${c.label}: "${c.context}"`),
        affectedEntities: [],
        recommendation: 'URGENT: Review the specific filings containing this language. "Going concern" and "bankruptcy" language indicates existential risk.',
      });
    }

    const high = riskLanguage.filter((r) => r.severity === 'HIGH');
    if (high.length > 0 && critical.length === 0) {
      findings.push({
        type: 'HIGH_RISK_FILING_LANGUAGE',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `${high.length} high-risk pattern(s) in filing language`,
        description: `Filing analysis detected: ${high.map((h) => h.label).join(', ')}. These indicate significant regulatory, legal, or financial concerns.`,
        evidence: high.slice(0, 5).map((h) => `${h.label}: "${h.context}"`),
        affectedEntities: [],
        recommendation: 'Review the flagged filing sections. Cross-reference with court records and regulatory databases.',
      });
    }

    return findings;
  }

  private emptyResult(): NlpResult {
    return { riskLanguage: [], overallSentiment: 'NEUTRAL', riskDensity: 0, findings: [] };
  }
}
