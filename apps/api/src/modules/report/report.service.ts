import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { InvestigationService } from '../investigation/investigation.service';

// Color palette — darker, more contrast on white
const C = {
  black: '#0F172A',
  dark: '#1E293B',
  text: '#334155',
  label: '#475569',
  gray: '#64748B',
  rule: '#CBD5E1',
  faint: '#E2E8F0',
  pageBg: '#F8FAFC',
  red: '#DC2626',
  amber: '#D97706',
  orange: '#EA580C',
  green: '#059669',
  blue: '#2563EB',
};

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sevColor(sev: string): string {
  return sev === 'CRITICAL' ? C.red : sev === 'HIGH' ? C.orange : sev === 'MEDIUM' ? C.amber : C.gray;
}

function sevBg(sev: string): string {
  return sev === 'CRITICAL' ? '#FEE2E2' : sev === 'HIGH' ? '#FFEDD5' : sev === 'MEDIUM' ? '#FEF3C7' : '#F1F5F9';
}

@Injectable()
export class ReportService {
  constructor(private readonly investigations: InvestigationService) {}

  async generatePdf(investigationId: string): Promise<Buffer> {
    const inv = await this.investigations.findOne(investigationId);
    const relations = await this.investigations.computeRelationsPublic(investigationId);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 475;
      const L = 60; // left margin
      const R = 535; // right edge
      const companyName = inv.companyName || inv.query;
      const findings = inv.findings || [];
      const entities = inv.entities || {};
      const matches = inv.matches || [];
      const uboChains = inv.uboChains || [];
      const score = inv.riskScore ?? 0;
      const counts = inv.counts || {};

      // Build relation sets
      const targetIds = new Set<string>();
      const directorIds = new Set<string>();
      for (const [id, rel] of relations) {
        if (rel === 'Target') targetIds.add(id);
        if (rel === 'Director' || rel === 'PSC/Owner') directorIds.add(id);
      }
      for (const group of ['company', 'person', 'address']) {
        for (const e of (entities as any)[group] || []) {
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

      const targetEntity = (entities.company || []).find((c: any) => targetIds.has(c.id));
      const meta = targetEntity?.metadata || {};

      // =============================================
      // PAGE 1 — COVER
      // =============================================
      doc.moveDown(8);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text('TRACEGRAPH', { characterSpacing: 4, align: 'center' });
      doc.font('Helvetica').fontSize(11).fillColor(C.label).text('Corporate Intelligence Report', { align: 'center' });
      doc.moveDown(5);
      doc.font('Helvetica-Bold').fontSize(30).fillColor(C.black).text(companyName, { align: 'center' });
      doc.moveDown(0.8);
      const coverDetails: string[] = [];
      if (inv.rootCompanyNumber) coverDetails.push(`Company ${inv.rootCompanyNumber}`);
      if (meta.jurisdiction) coverDetails.push(titleCase(meta.jurisdiction.replace(/-/g, ' ')));
      doc.font('Helvetica').fontSize(11).fillColor(C.label).text(coverDetails.join('  ·  '), { align: 'center' });
      doc.moveDown(4);

      // Risk score
      const scoreColor = score >= 75 ? C.red : score >= 50 ? C.orange : score >= 25 ? C.amber : C.green;
      doc.font('Helvetica-Bold').fontSize(64).fillColor(scoreColor).text(`${score}`, { align: 'center' });
      doc.font('Helvetica').fontSize(11).fillColor(C.label).text('/ 100  RISK SCORE', { align: 'center' });
      doc.moveDown(1);
      const tierLabel = inv.tier === 'DEEP' ? 'Deep Investigation' : inv.tier === 'QUICK' ? 'Quick Scan' : 'Standard Investigation';
      doc.fontSize(9).fillColor(C.gray).text(tierLabel, { align: 'center' });
      doc.moveDown(6);

      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.label).text('CONFIDENTIAL', { align: 'center', characterSpacing: 3 });
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(
        `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}  ·  Report ID: ${investigationId.slice(0, 8)}`,
        { align: 'center' },
      );
      doc.fontSize(8).fillColor(C.gray).text('Generated by TraceGraph', { align: 'center' });

      // =============================================
      // PAGE 2 — EXECUTIVE SUMMARY
      // =============================================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Executive Summary');
      doc.moveDown(0.8);

      const age = meta.incorporationDate ? Math.floor((Date.now() - new Date(meta.incorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
      const leadership = (entities.person || []).filter((p: any) => {
        const r = relations.get(p.id); return r === 'Director' || r === 'PSC/Owner';
      });

      const summaryParts: string[] = [];
      summaryParts.push(`${companyName} is ${meta.status === 'active' ? 'an active' : 'a ' + titleCase(meta.status || 'registered')} ${titleCase(meta.companyType || 'company')}`);
      if (age !== null) summaryParts.push(`incorporated ${age} years ago`);
      summaryParts.push(`with ${leadership.length} directors/PSCs and a network of ${(counts.companies || 0).toLocaleString()} connected companies.`);
      if (targetFindings.length > 0) summaryParts.push(`${targetFindings.length} risk signals were detected directly on the target company.`);
      else summaryParts.push('No risk signals were detected directly on the target company.');
      if (matches.length > 0) summaryParts.push(`${matches.length} cross-source match${matches.length > 1 ? 'es' : ''} found against sanctions or offshore databases.`);

      doc.font('Helvetica').fontSize(10.5).fillColor(C.text).text(summaryParts.join(' '), { lineGap: 4 });
      doc.moveDown(1.5);

      // Verdict box
      const verdict = score >= 75 ? { label: 'DO NOT PROCEED WITHOUT LEGAL REVIEW', color: C.red }
        : score >= 50 ? { label: 'ENHANCED DUE DILIGENCE RECOMMENDED', color: C.orange }
        : score >= 25 ? { label: 'PROCEED WITH CAUTION', color: C.amber }
        : { label: 'PROCEED', color: C.green };

      const vY = doc.y;
      doc.rect(L, vY, W, 40).fill(verdict.color);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text(verdict.label, L, vY + 13, { width: W, align: 'center' });
      doc.y = vY + 54;

      // Key stats
      this.statRow(doc, [
        { label: 'ENTITIES', value: String((counts.companies || 0) + (counts.people || 0) + (counts.addresses || 0)) },
        { label: 'CONNECTIONS', value: String(counts.edges || 0) },
        { label: 'FINDINGS', value: String(findings.length) },
        { label: 'MATCHES', value: String(matches.length) },
      ]);
      doc.moveDown(2);

      // Company profile
      this.sectionTitle(doc, 'Company Profile');
      doc.moveDown(0.5);
      const fields: [string, string][] = [];
      if (meta.status) fields.push(['Status', titleCase(meta.status)]);
      if (meta.companyType) fields.push(['Type', titleCase(meta.companyType)]);
      if (meta.incorporationDate) fields.push(['Incorporated', meta.incorporationDate]);
      if (meta.accountsType) fields.push(['Accounts', titleCase(meta.accountsType)]);
      if (meta.jurisdiction) fields.push(['Jurisdiction', titleCase(meta.jurisdiction.replace(/-/g, ' '))]);
      if (meta.filingHealth) fields.push(['Filing Health', `${meta.filingHealth.band} (${meta.filingHealth.score}/100)`]);
      if (meta.shellCompanyScore) fields.push(['Shell Risk', `${meta.shellCompanyScore.risk} (${meta.shellCompanyScore.score}/100)`]);
      if (meta.ownershipOpacity) fields.push(['Ownership Transparency', `${meta.ownershipOpacity.band} (${meta.ownershipOpacity.score}/100)`]);
      for (const [label, value] of fields) this.fieldRow(doc, label, value);

      // =============================================
      // PAGE 3 — OWNERSHIP
      // =============================================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Ownership Structure');
      doc.moveDown(0.8);

      if (uboChains.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(C.gray).text('No UBO chains resolved. Ownership data may be limited.');
      } else {
        for (const chain of uboChains.slice(0, 3)) {
          this.checkPageBreak(doc, 140, companyName);
          const path = chain.path || [];
          const ubo = path[0];

          doc.font('Helvetica-Bold').fontSize(12).fillColor(C.black).text(`Ultimate Beneficial Owner`);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark).text(ubo?.name || 'Unknown');
          if (chain.effectiveOwnershipPct != null) {
            doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`${chain.effectiveOwnershipPct}% effective ownership`);
          }
          doc.moveDown(1.2);

          // Chain nodes — clear vertical spacing
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            const indent = i * 24;
            const x = L + 10 + indent;

            if (i > 0) {
              // Draw connector
              doc.font('Helvetica').fontSize(10).fillColor(C.rule).text('|', x - 6, doc.y);
              doc.moveDown(0.1);
              doc.font('Helvetica').fontSize(10).fillColor(C.rule).text('|___', x - 6, doc.y, { continued: true });
              doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(` ${node.name}`);
            } else {
              doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(node.name, x);
            }

            // Details line
            const details: string[] = [];
            details.push(node.kind === 'person' ? 'Natural Person' : 'Company');
            if (node.ownershipPct) details.push(`${node.ownershipPct}% ownership`);
            if (node.jurisdiction) details.push(node.jurisdiction);
            if (node.companyNumber) details.push(node.companyNumber);
            doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(details.join('  ·  '), x + (i > 0 ? 20 : 0));
            doc.moveDown(0.8);
          }

          doc.moveDown(0.5);
          if (chain.terminationReason) {
            doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`Chain resolved: ${chain.terminationReason}`);
          }
          doc.moveDown(2.5);
        }
      }

      // =============================================
      // PAGE 4 — LEADERSHIP
      // =============================================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Leadership Assessment');
      doc.moveDown(0.8);

      if (leadership.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(C.gray).text('No direct directors or PSCs found.');
      } else {
        // Table header
        const hY = doc.y;
        doc.rect(L, hY, W, 20).fill('#F1F5F9');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.label);
        doc.text('NAME', L + 5, hY + 6, { width: 155 });
        doc.text('ROLE', L + 160, hY + 6, { width: 55 });
        doc.text('NATIONALITY', L + 215, hY + 6, { width: 70 });
        doc.text('TRACK RECORD', L + 285, hY + 6, { width: 100 });
        doc.text('RISK', L + 390, hY + 6, { width: 85 });
        doc.y = hY + 24;

        for (const person of leadership) {
          this.checkPageBreak(doc, 28, companyName);
          const pmeta = person.metadata || {};
          const dp = pmeta.directorProfile || {};
          const rel = relations.get(person.id) || 'Director';
          const role = rel === 'PSC/Owner' ? 'PSC' : 'Director';
          const risk = dp.risk && dp.risk !== 'NORMAL' ? dp.risk.replace(/_/g, ' ') : '-';
          const riskColor = (dp.risk === 'NOMINEE_PATTERN' || dp.risk === 'FORMATION_AGENT') ? C.red : C.text;
          const track = dp.totalAppointments ? `${dp.active || 0} active, ${dp.dissolved || 0} dissolved` : '-';

          const y = doc.y;
          // Alternate row shading
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.dark).text(person.label, L + 5, y, { width: 155 });
          doc.font('Helvetica').fontSize(8).fillColor(role === 'PSC' ? C.orange : C.label).text(role, L + 160, y, { width: 55 });
          doc.font('Helvetica').fontSize(8).fillColor(C.text).text(pmeta.nationality || '-', L + 215, y, { width: 70 });
          doc.font('Helvetica').fontSize(8).fillColor(C.text).text(track, L + 285, y, { width: 100 });
          doc.font('Helvetica-Bold').fontSize(8).fillColor(riskColor).text(risk, L + 390, y, { width: 85 });
          doc.y = Math.max(doc.y, y + 16);

          if (person.matches?.length > 0) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(C.red).text(
              `SANCTIONS MATCH: ${person.matches.map((m: any) => `${m.reasons?.matchedName || m.matchedEntityId} (${m.confidence}%)`).join(', ')}`,
              L + 5,
            );
          }

          // Row divider
          doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).strokeColor(C.faint).stroke();
          doc.y += 6;
        }
      }

      // =============================================
      // PAGE 5+ — FINDINGS
      // =============================================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, `Findings on ${companyName}`);
      doc.moveDown(0.5);

      if (targetFindings.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text(`No risk signals detected directly on ${companyName}.`);
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(`${targetFindings.length} finding${targetFindings.length > 1 ? 's' : ''} directly affecting the target company:`);
        doc.moveDown(0.8);
        this.renderFindings(doc, targetFindings.slice(0, 15), companyName);
        if (targetFindings.length > 15) {
          doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`  + ${targetFindings.length - 15} more findings (see full report online)`);
        }
      }
      doc.moveDown(3);
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke();
      doc.moveDown(2);

      // Director findings
      this.checkPageBreak(doc, 100, companyName);
      this.sectionTitle(doc, 'Findings on Directors');
      doc.moveDown(0.5);
      if (directorFindings.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text('No risk signals on target company directors.');
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(`${directorFindings.length} finding${directorFindings.length > 1 ? 's' : ''} about directors and PSCs:`);
        doc.moveDown(0.8);
        this.renderFindings(doc, directorFindings.slice(0, 10), companyName);
        if (directorFindings.length > 10) {
          doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`  + ${directorFindings.length - 10} more director findings`);
        }
      }
      doc.moveDown(3);
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke();
      doc.moveDown(2);

      // Network summary
      this.checkPageBreak(doc, 100, companyName);
      this.sectionTitle(doc, 'Network Findings Summary');
      doc.moveDown(0.5);
      if (networkFindings.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text('No findings in the wider network.');
      } else {
        const nCrit = networkFindings.filter((f: any) => f.severity === 'CRITICAL').length;
        const nHigh = networkFindings.filter((f: any) => f.severity === 'HIGH').length;
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(
          `${networkFindings.length.toLocaleString()} findings in the wider network (${nCrit} critical, ${nHigh} high). Top 5:`,
        );
        doc.moveDown(0.8);
        const topNet = [...networkFindings].sort((a: any, b: any) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
        this.renderFindings(doc, topNet.slice(0, 5), companyName);
      }

      // Cross-source matches
      if (matches.length > 0) {
        doc.moveDown(2);
        this.checkPageBreak(doc, 80, companyName);
        this.sectionTitle(doc, 'Cross-Source Matches');
        doc.moveDown(0.5);
        for (const m of matches.slice(0, 10)) {
          this.checkPageBreak(doc, 30, companyName);
          const src = m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks';
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(m.reasons?.matchedName || m.matchedEntityId, { continued: true });
          doc.font('Helvetica-Bold').fontSize(9).fillColor(m.confidence >= 75 ? C.red : C.amber).text(`  ${m.confidence}%`, { continued: true });
          doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`  ${src}`);
          doc.moveDown(0.4);
        }
      }

      // =============================================
      // FINAL PAGE — METHODOLOGY
      // =============================================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Methodology & Sources');
      doc.moveDown(0.8);

      doc.font('Helvetica').fontSize(10).fillColor(C.text).text(
        'This report was generated using publicly available data from the following sources:', { lineGap: 3 },
      );
      doc.moveDown(0.8);

      const sources = [
        ['UK Companies House API', 'Company profiles, officers, PSCs, filing history, charges, registered offices'],
        ['OpenSanctions', '4.1 million sanctions, PEP, and watchlist entities from 100+ global sources'],
        ['ICIJ OffshoreLeaks', '770,000+ offshore entities, officers, and intermediaries from leaked databases'],
      ];
      for (const [name, desc] of sources) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.dark).text(name, { continued: true });
        doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`  -  ${desc}`);
        doc.moveDown(0.5);
      }
      doc.moveDown(1.5);

      this.sectionTitle(doc, 'Risk Scoring');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9).fillColor(C.text).text(
        'The risk score (0-100) is computed from 30+ automated detectors analyzing: shell company indicators, ' +
        'director network patterns, filing health, ownership transparency, and sanctions proximity.',
        { lineGap: 3 },
      );
      doc.moveDown(1);

      const scores = [
        { range: '0-24', label: 'Low Risk', color: C.green, desc: 'No significant concerns identified' },
        { range: '25-49', label: 'Elevated', color: C.amber, desc: 'Some signals warrant review' },
        { range: '50-74', label: 'High', color: C.orange, desc: 'Enhanced due diligence recommended' },
        { range: '75-100', label: 'Critical', color: C.red, desc: 'Do not proceed without legal review' },
      ];
      for (const s of scores) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(s.color).text(`${s.range}  ${s.label}`, { continued: true });
        doc.font('Helvetica').fillColor(C.text).text(`  -  ${s.desc}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(2);

      // Disclaimer
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.rule).stroke();
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.label).text('DISCLAIMER');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(
        'This report is generated from publicly available data and automated analysis. It does not constitute legal, ' +
        'financial, or professional advice. The risk score is indicative and should not be the sole basis for business ' +
        'decisions. Independent verification of all findings is recommended before taking any action.',
        { lineGap: 2 },
      );
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(8).fillColor(C.label).text(
        `Report generated ${new Date().toISOString().slice(0, 10)}  ·  Investigation ${investigationId.slice(0, 8)}  ·  TraceGraph v1.0`,
      );

      // Page numbers
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(7).fillColor(C.gray).text(
          `Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 40, { width: doc.page.width, align: 'center' },
        );
        if (i > 0) {
          doc.font('Helvetica').fontSize(7).fillColor(C.gray).text('TraceGraph Confidential', L, doc.page.height - 40);
        }
      }

      doc.end();
    });
  }

  private renderFindings(doc: any, findings: any[], companyName: string) {
    const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
    for (let fi = 0; fi < sorted.length; fi++) {
      const f = sorted[fi];
      this.checkPageBreak(doc, 80, companyName);

      // Severity badge with background
      const y = doc.y;
      const badgeW = 55;
      doc.rect(60, y, badgeW, 16).fill(sevBg(f.severity));
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(sevColor(f.severity)).text(f.severity, 60, y + 4, { width: badgeW, align: 'center' });

      // Title
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(f.title, 60 + badgeW + 8, y + 1, { width: 475 - badgeW - 8 });
      doc.y = Math.max(doc.y, y + 20);
      doc.moveDown(0.3);

      // Description
      const desc = (f.description || '').slice(0, 250) + (f.description?.length > 250 ? '...' : '');
      doc.font('Helvetica').fontSize(9).fillColor(C.text).text(desc, { lineGap: 2 });
      doc.moveDown(0.3);

      // Business impact
      if (f.businessImpact) {
        const impact = f.businessImpact.slice(0, 180) + (f.businessImpact.length > 180 ? '...' : '');
        doc.font('Helvetica').fontSize(8).fillColor(C.label).text(`Impact: ${impact}`);
      }

      // Verification links
      if (f.verificationLinks?.length > 0) {
        for (const link of f.verificationLinks) {
          doc.font('Helvetica').fontSize(8).fillColor(C.blue).text(link.label, { link: link.url, underline: true });
        }
      }

      // Divider
      doc.moveDown(1);
      if (fi < sorted.length - 1) {
        doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(C.faint).stroke();
        doc.moveDown(1);
      }
    }
  }

  private pageHeader(doc: any, companyName: string) {
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.label).text(companyName, 60, 32);
    doc.font('Helvetica').fontSize(7).fillColor(C.label).text('TraceGraph Intelligence Report', 60, 32, { width: 475, align: 'right' });
    doc.moveTo(60, 44).lineTo(535, 44).strokeColor(C.faint).stroke();
    doc.y = 56;
  }

  private sectionTitle(doc: any, title: string) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.dark).text(title.toUpperCase(), { characterSpacing: 1.5 });
    doc.moveTo(60, doc.y + 3).lineTo(535, doc.y + 3).strokeColor(C.rule).stroke();
    doc.moveDown(0.5);
  }

  private fieldRow(doc: any, label: string, value: string) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(C.label).text(label, 60, y, { width: 150 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.dark).text(value, 210, y, { width: 325 });
    doc.y = Math.max(doc.y, y + 16);
  }

  private statRow(doc: any, stats: Array<{ label: string; value: string }>) {
    const colW = 475 / stats.length;
    const y = doc.y;
    // Background
    doc.rect(60, y - 4, 475, 40).fill('#F8FAFC');
    for (let i = 0; i < stats.length; i++) {
      const x = 60 + i * colW + 8;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(C.black).text(stats[i].value, x, y, { width: colW - 8 });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.label).text(stats[i].label, x, y + 20, { width: colW - 8, characterSpacing: 0.8 });
    }
    doc.y = y + 44;
  }

  private checkPageBreak(doc: any, needed: number, companyName: string) {
    if (doc.y + needed > doc.page.height - 60) {
      doc.addPage();
      this.pageHeader(doc, companyName);
    }
  }
}
