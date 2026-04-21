import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

/**
 * FATF (Financial Action Task Force) Jurisdiction Risk Service.
 *
 * Scores subsidiary jurisdictions against FATF grey/blacklists,
 * tax haven lists, and secrecy jurisdiction rankings.
 *
 * No API needed — uses hardcoded authoritative lists updated periodically.
 */

// FATF Blacklist (Call for Action) — as of 2025
const FATF_BLACKLIST = new Set([
  'north korea', 'iran', 'myanmar',
]);

// FATF Greylist (Increased Monitoring) — as of 2025
const FATF_GREYLIST = new Set([
  'albania', 'barbados', 'burkina faso', 'cameroon', 'croatia',
  'democratic republic of the congo', 'gibraltar', 'haiti',
  'jamaica', 'jordan', 'mali', 'mozambique', 'nigeria',
  'panama', 'philippines', 'senegal', 'south africa', 'south sudan',
  'syria', 'tanzania', 'türkiye', 'turkey', 'uganda',
  'united arab emirates', 'uae', 'vietnam', 'yemen',
]);

// Known secrecy / tax haven jurisdictions
const SECRECY_JURISDICTIONS = new Set([
  'cayman islands', 'british virgin islands', 'bvi', 'bermuda',
  'jersey', 'guernsey', 'isle of man', 'luxembourg', 'liechtenstein',
  'monaco', 'andorra', 'bahamas', 'antigua and barbuda', 'barbados',
  'belize', 'dominica', 'grenada', 'marshall islands', 'nauru',
  'niue', 'palau', 'panama', 'saint kitts and nevis', 'saint lucia',
  'saint vincent and the grenadines', 'samoa', 'seychelles',
  'turks and caicos islands', 'vanuatu', 'us virgin islands',
  'hong kong', 'singapore', 'mauritius', 'curacao', 'aruba',
  'gibraltar', 'labuan', 'delaware', 'nevada', 'wyoming', 'south dakota',
]);

// EU Blacklist of non-cooperative jurisdictions for tax purposes
const EU_TAX_BLACKLIST = new Set([
  'american samoa', 'anguilla', 'fiji', 'guam', 'palau',
  'panama', 'samoa', 'trinidad and tobago', 'us virgin islands', 'vanuatu',
]);

type JurisdictionRisk = 'BLACKLISTED' | 'GREYLISTED' | 'SECRECY' | 'EU_TAX_BLACKLIST' | 'STANDARD';

interface JurisdictionResult {
  jurisdiction: string;
  risk: JurisdictionRisk;
  lists: string[];
}

@Injectable()
export class FatfJurisdictionService {
  private readonly logger = new Logger(FatfJurisdictionService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async analyze(investigationId: string): Promise<{ results: JurisdictionResult[]; findings: Finding[] }> {
    const companies = await this.nodes.find({
      where: { investigationId, entityType: 'company' },
    });

    // Collect all unique jurisdictions
    const jurisdictions = new Set<string>();
    for (const co of companies) {
      const meta = co.metadata as any;
      const j = meta?.jurisdiction;
      if (j && typeof j === 'string' && j.length > 1) {
        jurisdictions.add(j.toLowerCase().trim());
      }
    }

    this.logger.log(`FATF jurisdiction check: ${jurisdictions.size} unique jurisdictions`);

    const results: JurisdictionResult[] = [];
    for (const j of jurisdictions) {
      const result = this.classifyJurisdiction(j);
      if (result.risk !== 'STANDARD') {
        results.push(result);
      }
    }

    const findings = this.generateFindings(results);

    // Update subsidiary nodes with jurisdiction risk
    for (const co of companies) {
      const meta = co.metadata as any;
      const j = (meta?.jurisdiction || '').toLowerCase().trim();
      if (!j) continue;
      const result = this.classifyJurisdiction(j);
      if (result.risk !== 'STANDARD') {
        meta.fatfRisk = result.risk;
        meta.fatfLists = result.lists;
        await this.nodes.update(co.id, { metadata: meta }).catch(() => {});
      }
    }

    this.logger.log(`FATF check complete: ${results.length} high-risk jurisdictions found`);
    return { results, findings };
  }

  private classifyJurisdiction(jurisdiction: string): JurisdictionResult {
    const j = jurisdiction.toLowerCase().trim();
    const lists: string[] = [];
    let risk: JurisdictionRisk = 'STANDARD';

    if (FATF_BLACKLIST.has(j)) {
      risk = 'BLACKLISTED';
      lists.push('FATF Blacklist (Call for Action)');
    } else if (FATF_GREYLIST.has(j)) {
      risk = 'GREYLISTED';
      lists.push('FATF Greylist (Increased Monitoring)');
    }

    if (SECRECY_JURISDICTIONS.has(j)) {
      if (risk === 'STANDARD') risk = 'SECRECY';
      lists.push('Secrecy / Tax Haven Jurisdiction');
    }

    if (EU_TAX_BLACKLIST.has(j)) {
      if (risk === 'STANDARD') risk = 'EU_TAX_BLACKLIST';
      lists.push('EU Tax Blacklist');
    }

    return { jurisdiction, risk, lists };
  }

  private generateFindings(results: JurisdictionResult[]): Finding[] {
    const findings: Finding[] = [];

    const blacklisted = results.filter((r) => r.risk === 'BLACKLISTED');
    const greylisted = results.filter((r) => r.risk === 'GREYLISTED');
    const secrecy = results.filter((r) => r.lists.includes('Secrecy / Tax Haven Jurisdiction'));
    const euBlacklist = results.filter((r) => r.lists.includes('EU Tax Blacklist'));

    if (blacklisted.length > 0) {
      findings.push({
        type: 'FATF_BLACKLIST',
        severity: 'CRITICAL',
        confidence: 'HIGH',
        title: `Subsidiaries in ${blacklisted.length} FATF-blacklisted jurisdiction${blacklisted.length !== 1 ? 's' : ''}`,
        description: `The network includes entities in FATF-blacklisted jurisdictions: ${blacklisted.map((r) => r.jurisdiction).join(', ')}. ` +
          `FATF blacklisted countries have strategic deficiencies in their AML/CFT regimes and are subject to a call for countermeasures. ` +
          `Business relationships with entities in these jurisdictions require the highest level of scrutiny.`,
        evidence: blacklisted.map((r) => `${r.jurisdiction}: ${r.lists.join(', ')}`),
        affectedEntities: [],
        recommendation: 'CRITICAL: Apply enhanced due diligence (EDD) and consider whether the business relationship is permissible under your jurisdiction\'s regulations. Many regulators prohibit or restrict transactions with FATF-blacklisted countries.',
      });
    }

    if (greylisted.length > 0) {
      findings.push({
        type: 'FATF_GREYLIST',
        severity: 'HIGH',
        confidence: 'HIGH',
        title: `Subsidiaries in ${greylisted.length} FATF-greylisted jurisdiction${greylisted.length !== 1 ? 's' : ''}`,
        description: `The network includes entities in FATF-greylisted jurisdictions (under increased monitoring): ${greylisted.map((r) => r.jurisdiction).join(', ')}. ` +
          `These countries have committed to resolving identified AML/CFT deficiencies within agreed timeframes.`,
        evidence: greylisted.map((r) => `${r.jurisdiction}: ${r.lists.join(', ')}`),
        affectedEntities: [],
        recommendation: 'Apply enhanced due diligence for transactions involving these jurisdictions. Monitor FATF updates for changes in status.',
      });
    }

    if (secrecy.length > 0) {
      findings.push({
        type: 'SECRECY_JURISDICTION',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        title: `${secrecy.length} entit${secrecy.length !== 1 ? 'ies' : 'y'} in secrecy/tax haven jurisdictions`,
        description: `The network has presence in known secrecy or tax haven jurisdictions: ${secrecy.map((r) => r.jurisdiction).join(', ')}. ` +
          `While having subsidiaries in these jurisdictions is common for multinational companies, it increases opacity and tax risk.`,
        evidence: secrecy.map((r) => `${r.jurisdiction}: ${r.lists.join(', ')}`),
        affectedEntities: [],
        recommendation: 'Assess whether the jurisdictional structure has a legitimate business purpose. Tax-motivated structures are not inherently illegal but warrant documentation.',
      });
    }

    return findings;
  }
}
