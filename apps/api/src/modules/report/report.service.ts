import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { InvestigationService } from '../investigation/investigation.service';

const DARK = '#0F172A';
const GRAY = '#475569';
const LIGHT = '#64748B';
const MUTED = '#94A3B8';
const RED = '#DC2626';
const AMBER = '#F59E0B';
const GREEN = '#10B981';
const BLUE = '#3B82F6';

@Injectable()
export class ReportService {
  constructor(private readonly investigations: InvestigationService) {}

  async generatePdf(investigationId: string): Promise<Buffer> {
    const inv = await this.investigations.findOne(investigationId);
    const relations = await this.investigations.computeRelationsPublic(investigationId);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const companyName = inv.companyName || inv.query;
      const findings = inv.findings || [];
      const entities = inv.entities || {};
      const matches = inv.matches || [];
      const uboChains = inv.uboChains || [];
      const score = inv.riskScore ?? 0;

      // === TITLE PAGE ===
      doc.fontSize(9).fillColor(MUTED).text('TRACEGRAPH', { characterSpacing: 3 });
      doc.fontSize(9).fillColor(MUTED).text('INVESTIGATION REPORT');
      doc.moveDown(3);
      doc.fontSize(28).fillColor(DARK).text(companyName);
      doc.moveDown(0.5);
      if (inv.rootCompanyNumber) {
        doc.fontSize(10).fillColor(LIGHT).text(`Company number: ${inv.rootCompanyNumber}`);
      }
      doc.fontSize(10).fillColor(LIGHT).text(`Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
      doc.fontSize(10).fillColor(LIGHT).text(`Investigation tier: ${inv.tier || 'Standard'}`);
      doc.moveDown(3);

      // Risk score
      const scoreColor = score >= 60 ? RED : score >= 30 ? AMBER : GREEN;
      const scoreLabel = score >= 60 ? 'HIGH RISK' : score >= 30 ? 'ELEVATED' : 'LOW RISK';
      doc.fontSize(10).fillColor(MUTED).text('OVERALL RISK SCORE', { characterSpacing: 1 });
      doc.fontSize(48).fillColor(scoreColor).text(`${score}`, { continued: true });
      doc.fontSize(14).fillColor(MUTED).text(`  / 100    ${scoreLabel}`);
      doc.moveDown(1);

      // Network stats
      const counts = inv.counts || {};
      doc.fontSize(10).fillColor(LIGHT).text(
        `${counts.companies || 0} companies  ·  ${counts.people || 0} people  ·  ${counts.addresses || 0} addresses  ·  ${counts.edges || 0} connections`,
      );
      doc.moveDown(3);

      // === EXECUTIVE SUMMARY ===
      this.section(doc, 'Executive summary');

      // Classify findings by relevance
      const targetIds = new Set<string>();
      const directorIds = new Set<string>();
      for (const [id, rel] of relations) {
        if (rel === 'Target') targetIds.add(id);
        if (rel === 'Director' || rel === 'PSC/Owner') directorIds.add(id);
      }
      // Add entityId aliases
      for (const group of ['company', 'person', 'address']) {
        for (const e of entities[group] || []) {
          if (targetIds.has(e.id) && e.entityId) targetIds.add(e.entityId);
          if (directorIds.has(e.id) && e.entityId) directorIds.add(e.entityId);
        }
      }

      const targetFindings = findings.filter((f: any) => (f.affectedEntities || []).some((id: string) => targetIds.has(id)));
      const directorFindings = findings.filter((f: any) =>
        !(f.affectedEntities || []).some((id: string) => targetIds.has(id)) &&
        (f.affectedEntities || []).some((id: string) => directorIds.has(id)),
      );
      const networkFindings = findings.filter((f: any) =>
        !(f.affectedEntities || []).some((id: string) => targetIds.has(id)) &&
        !(f.affectedEntities || []).some((id: string) => directorIds.has(id)),
      );

      const critical = findings.filter((f: any) => f.severity === 'CRITICAL').length;
      const high = findings.filter((f: any) => f.severity === 'HIGH').length;

      doc.fontSize(11).fillColor(DARK).text(
        `${companyName} was investigated across ${counts.companies || 0} companies and ${counts.people || 0} people. ` +
        `${targetFindings.length} findings directly affect the target company, ${directorFindings.length} relate to its directors and PSCs, ` +
        `and ${networkFindings.length.toLocaleString()} were found in the wider network. ` +
        (matches.length > 0 ? `${matches.length} cross-source match${matches.length > 1 ? 'es' : ''} found against sanctions/offshore databases. ` : '') +
        `Overall risk score: ${score}/100.`,
      );
      doc.moveDown(2);

      // === TARGET COMPANY PROFILE ===
      this.section(doc, `About ${companyName}`);
      const targetEntity = (entities.company || []).find((c: any) => targetIds.has(c.id));
      if (targetEntity) {
        const meta = targetEntity.metadata || {};
        this.field(doc, 'Status', meta.status || 'Unknown');
        this.field(doc, 'Type', meta.companyType || 'Unknown');
        if (meta.incorporationDate) this.field(doc, 'Incorporated', meta.incorporationDate);
        if (meta.accountsType) this.field(doc, 'Accounts', meta.accountsType);
        if (meta.jurisdiction) this.field(doc, 'Jurisdiction', meta.jurisdiction);
        if (meta.sicCodes?.length) this.field(doc, 'SIC codes', meta.sicCodes.join(', '));
        if (meta.filingHealth) {
          const fh = meta.filingHealth;
          this.field(doc, 'Filing health', `${fh.band} (${fh.score}/100)${fh.lateAccountsCount > 0 ? ` - ${fh.lateAccountsCount} late filings` : ''}`);
        }
        if (meta.shellCompanyScore) {
          this.field(doc, 'Shell risk', `${meta.shellCompanyScore.risk} (${meta.shellCompanyScore.score}/100)`);
          if (meta.shellCompanyScore.reasons?.length > 0) {
            for (const r of meta.shellCompanyScore.reasons) {
              doc.fontSize(8).fillColor(GRAY).text(`    - ${r}`);
            }
          }
        }
        if (meta.ownershipOpacity) {
          this.field(doc, 'Ownership transparency', `${meta.ownershipOpacity.band} (${meta.ownershipOpacity.score}/100)`);
        }
      }
      doc.moveDown(1);

      // Target findings
      if (targetFindings.length > 0) {
        doc.fontSize(10).fillColor(DARK).text(`${targetFindings.length} findings on ${companyName}:`);
        doc.moveDown(0.5);
        this.renderFindings(doc, targetFindings);
      } else {
        doc.fontSize(10).fillColor(GREEN).text(`No risk signals detected directly on ${companyName}.`);
      }
      doc.moveDown(2);

      // === LEADERSHIP ===
      this.checkPageBreak(doc, 100);
      this.section(doc, 'Leadership');
      const leadership = (entities.person || []).filter((p: any) => {
        const rel = relations.get(p.id);
        return rel === 'Director' || rel === 'PSC/Owner';
      });

      if (leadership.length === 0) {
        doc.fontSize(10).fillColor(LIGHT).text('No direct directors or PSCs found.');
      } else {
        for (const person of leadership) {
          this.checkPageBreak(doc, 60);
          const rel = relations.get(person.id) || 'Director';
          const meta = person.metadata || {};
          const dp = meta.directorProfile || {};

          doc.fontSize(11).fillColor(DARK).text(person.label, { continued: true });
          doc.fontSize(9).fillColor(rel === 'PSC/Owner' ? AMBER : LIGHT).text(`  ${rel}`);

          const details: string[] = [];
          if (meta.nationality) details.push(meta.nationality);
          if (dp.totalAppointments) details.push(`${dp.active || 0} active, ${dp.dissolved || 0} dissolved directorships`);
          if (dp.risk && dp.risk !== 'NORMAL') details.push(`Risk profile: ${dp.risk.replace(/_/g, ' ')}`);
          if (meta.directorVelocity?.flagged) details.push(`Velocity flagged: ${meta.directorVelocity.reasons?.[0] || 'high turnover'}`);
          if (details.length > 0) doc.fontSize(9).fillColor(GRAY).text(details.join('  ·  '));

          // Sanctions matches on this person
          if (person.matches?.length > 0) {
            doc.fontSize(9).fillColor(RED).text(`SANCTIONS MATCH: ${person.matches.map((m: any) => `${m.reasons?.matchedName || m.matchedEntityId} (${m.confidence}%)`).join(', ')}`);
          }
          doc.moveDown(0.5);
        }
      }

      // Director findings
      if (directorFindings.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor(DARK).text(`${directorFindings.length} findings about directors:`);
        doc.moveDown(0.5);
        this.renderFindings(doc, directorFindings.slice(0, 20));
        if (directorFindings.length > 20) {
          doc.fontSize(8).fillColor(MUTED).text(`  ...and ${directorFindings.length - 20} more director findings`);
        }
      }
      doc.moveDown(2);

      // === UBO CHAINS ===
      if (uboChains.length > 0) {
        this.checkPageBreak(doc, 80);
        this.section(doc, 'Ultimate beneficial ownership');
        for (const chain of uboChains.slice(0, 5)) {
          this.checkPageBreak(doc, 40);
          const links = chain.chain || [];
          const ubo = links[links.length - 1];
          doc.fontSize(10).fillColor(DARK).text(`UBO: ${ubo?.name || 'Unknown'}`, { continued: true });
          if (ubo?.kind) doc.fontSize(8).fillColor(LIGHT).text(`  (${ubo.kind})`);
          else doc.text('');
          const path = links.map((l: any) => l.name).join(' > ');
          doc.fontSize(8).fillColor(GRAY).text(`  Chain: ${path}`);
          if (chain.controlTypes?.length) {
            doc.fontSize(8).fillColor(GRAY).text(`  Control: ${chain.controlTypes.join(', ')}`);
          }
          doc.moveDown(0.5);
        }
        doc.moveDown(1);
      }

      // === CROSS-SOURCE MATCHES ===
      this.checkPageBreak(doc, 80);
      this.section(doc, 'Cross-source matches');
      if (matches.length === 0) {
        doc.fontSize(10).fillColor(LIGHT).text(`No cross-source matches found. Screened ${(counts.companies || 0) + (counts.people || 0)} entities against OpenSanctions and ICIJ OffshoreLeaks.`);
      } else {
        for (const m of matches) {
          this.checkPageBreak(doc, 40);
          const sourceLabel = m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks';
          const confColor = m.confidence >= 75 ? RED : m.confidence >= 50 ? AMBER : LIGHT;
          doc.fontSize(10).fillColor(DARK).text(m.reasons?.matchedName || m.matchedEntityId, { continued: true });
          doc.fontSize(9).fillColor(confColor).text(`  ${m.confidence}%`, { continued: true });
          doc.fontSize(9).fillColor(LIGHT).text(`  ${sourceLabel}`);
          // Show which entity in our network matched
          const matchedEntity = [...(entities.company || []), ...(entities.person || [])].find((e: any) => e.entityId === m.sourceEntityId);
          if (matchedEntity) {
            const rel = relations.get(matchedEntity.id) || 'Network';
            doc.fontSize(8).fillColor(GRAY).text(`  Matched entity: ${matchedEntity.label} (${rel})`);
          }
          doc.moveDown(0.5);
        }
      }
      doc.moveDown(2);

      // === KEY NETWORK ENTITIES ===
      this.checkPageBreak(doc, 80);
      this.section(doc, 'Key network entities');
      const flaggedCompanies = (entities.company || []).filter((c: any) =>
        !targetIds.has(c.id) && (c.metadata?.shellCompanyScore?.risk === 'HIGH' || c.metadata?.shellCompanyScore?.risk === 'CRITICAL'),
      );
      const flaggedPeople = (entities.person || []).filter((p: any) => {
        const rel = relations.get(p.id);
        return rel !== 'Director' && rel !== 'PSC/Owner' &&
          (p.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN' || p.metadata?.directorProfile?.risk === 'FORMATION_AGENT');
      });

      if (flaggedCompanies.length === 0 && flaggedPeople.length === 0) {
        doc.fontSize(10).fillColor(GREEN).text('No notable risk entities found in the wider network.');
      } else {
        if (flaggedCompanies.length > 0) {
          doc.fontSize(10).fillColor(DARK).text(`${flaggedCompanies.length} companies with shell risk HIGH or CRITICAL:`);
          for (const c of flaggedCompanies.slice(0, 15)) {
            this.checkPageBreak(doc, 20);
            const shell = c.metadata?.shellCompanyScore || {};
            doc.fontSize(9).fillColor(GRAY).text(`  ${c.label}  -  shell risk ${shell.risk} (${shell.score}/100)`);
          }
          if (flaggedCompanies.length > 15) doc.fontSize(8).fillColor(MUTED).text(`  ...and ${flaggedCompanies.length - 15} more`);
          doc.moveDown(0.5);
        }
        if (flaggedPeople.length > 0) {
          doc.fontSize(10).fillColor(DARK).text(`${flaggedPeople.length} people with nominee/formation agent patterns:`);
          for (const p of flaggedPeople.slice(0, 10)) {
            this.checkPageBreak(doc, 20);
            doc.fontSize(9).fillColor(GRAY).text(`  ${p.label}  -  ${p.metadata?.directorProfile?.risk?.replace(/_/g, ' ')}`);
          }
          doc.moveDown(0.5);
        }
      }
      doc.moveDown(2);

      // === WIDER NETWORK FINDINGS (summary only) ===
      if (networkFindings.length > 0) {
        this.checkPageBreak(doc, 60);
        this.section(doc, 'Wider network findings');
        const netCritical = networkFindings.filter((f: any) => f.severity === 'CRITICAL').length;
        const netHigh = networkFindings.filter((f: any) => f.severity === 'HIGH').length;
        const netMedium = networkFindings.filter((f: any) => f.severity === 'MEDIUM').length;
        doc.fontSize(10).fillColor(GRAY).text(
          `${networkFindings.length.toLocaleString()} findings in the wider network ` +
          `(${netCritical} critical, ${netHigh} high, ${netMedium} medium). ` +
          `These relate to entities beyond the target company's direct circle.`,
        );
        doc.moveDown(0.5);
        // Show top 10 most severe
        const topNetwork = networkFindings
          .sort((a: any, b: any) => {
            const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
          })
          .slice(0, 10);
        this.renderFindings(doc, topNetwork);
        if (networkFindings.length > 10) {
          doc.fontSize(8).fillColor(MUTED).text(`  ...and ${networkFindings.length - 10} more network findings`);
        }
      }

      // === FOOTER ===
      doc.moveDown(3);
      doc.fontSize(8).fillColor(MUTED).text('---');
      doc.fontSize(8).fillColor(MUTED).text(`Report generated by TraceGraph. Investigation ID: ${investigationId}`);
      doc.fontSize(8).fillColor(MUTED).text('This report is generated from public data sources and does not constitute legal advice.');

      doc.end();
    });
  }

  // Expose computeRelations for the PDF
  // (We'll add a public wrapper in InvestigationService)

  private renderFindings(doc: any, findings: any[]) {
    for (const f of findings) {
      this.checkPageBreak(doc, 70);
      const sevColor = f.severity === 'CRITICAL' ? RED : f.severity === 'HIGH' ? AMBER : f.severity === 'MEDIUM' ? '#D97706' : MUTED;
      doc.fontSize(9).fillColor(sevColor).text(f.severity, { continued: true });
      doc.fontSize(10).fillColor(DARK).text(`  ${f.title}`);
      doc.fontSize(9).fillColor(GRAY).text(f.description);
      if (f.evidence?.length) {
        for (const e of f.evidence.slice(0, 3)) {
          doc.fontSize(8).fillColor(LIGHT).text(`    - ${e}`);
        }
        if (f.evidence.length > 3) doc.fontSize(8).fillColor(MUTED).text(`    ...and ${f.evidence.length - 3} more`);
      }
      if (f.businessImpact) {
        doc.fontSize(8).fillColor(GRAY).text(`  Business impact: ${f.businessImpact}`);
      }
      if (f.legalReference) {
        doc.fontSize(8).fillColor(LIGHT).text(`  Legal: ${f.legalReference}`);
      }
      doc.fontSize(8).fillColor(MUTED).text(`  Recommendation: ${f.recommendation}`, { oblique: true });
      doc.moveDown(0.8);
    }
  }

  private field(doc: any, label: string, value: string) {
    doc.fontSize(9).fillColor(LIGHT).text(`${label}: `, { continued: true });
    doc.fontSize(9).fillColor(DARK).text(value);
  }

  private section(doc: any, title: string) {
    doc.fontSize(8).fillColor(MUTED).text(title.toUpperCase(), { characterSpacing: 1 });
    doc.moveTo(doc.x, doc.y).lineTo(doc.x + 495, doc.y).strokeColor('#E2E8F0').stroke();
    doc.moveDown(0.5);
  }

  private checkPageBreak(doc: any, needed: number) {
    if (doc.y + needed > doc.page.height - 50) doc.addPage();
  }
}
