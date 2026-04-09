import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { InvestigationService } from '../investigation/investigation.service';

@Injectable()
export class ReportService {
  constructor(private readonly investigations: InvestigationService) {}

  async generatePdf(investigationId: string): Promise<Buffer> {
    const inv = await this.investigations.findOne(investigationId);

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Title page
      doc.fontSize(10).fillColor('#94A3B8').text('TRACEGRAPH INVESTIGATION REPORT', { align: 'left' });
      doc.moveDown(2);
      doc.fontSize(28).fillColor('#0F172A').text(inv.query, { align: 'left' });
      doc.fontSize(10).fillColor('#64748B').text(`Generated ${new Date().toLocaleString()}`);
      doc.moveDown(3);

      // Risk score
      const score = inv.riskScore ?? 0;
      const scoreColor = score >= 60 ? '#DC2626' : score >= 30 ? '#F59E0B' : '#10B981';
      const scoreLabel = score >= 60 ? 'HIGH RISK' : score >= 30 ? 'ELEVATED' : 'LOW RISK';
      doc.fontSize(12).fillColor('#64748B').text('OVERALL RISK SCORE');
      doc.fontSize(48).fillColor(scoreColor).text(`${score}`, { continued: true });
      doc.fontSize(14).fillColor('#94A3B8').text(`  / 100  ${scoreLabel}`);
      doc.moveDown(2);

      // Stats
      const counts = inv.counts || {};
      doc.fontSize(10).fillColor('#64748B').text(
        `Companies: ${counts.companies || 0}    People: ${counts.people || 0}    Addresses: ${counts.addresses || 0}    Connections: ${counts.edges || 0}`,
      );
      doc.moveDown(2);

      // Executive summary
      this.section(doc, 'Executive summary');
      const findings = inv.findings || [];
      const critical = findings.filter((f: any) => f.severity === 'CRITICAL').length;
      const high = findings.filter((f: any) => f.severity === 'HIGH').length;
      const medium = findings.filter((f: any) => f.severity === 'MEDIUM').length;
      const matchCount = inv.matches?.length || 0;
      const summary =
        findings.length === 0
          ? 'No risk signals were detected for this entity across the configured data sources.'
          : `This investigation surfaced ${findings.length} risk findings (${critical} critical, ${high} high, ${medium} medium) ` +
            `across ${counts.companies || 0} companies and ${counts.people || 0} people. ` +
            (matchCount > 0
              ? `${matchCount} cross-source matches were found against OpenSanctions or ICIJ OffshoreLeaks data. `
              : '') +
            `The overall risk score is ${score} / 100.`;
      doc.fontSize(11).fillColor('#0F172A').text(summary, { align: 'left' });
      doc.moveDown(2);

      // Findings
      this.section(doc, 'Findings');
      if (findings.length === 0) {
        doc.fontSize(10).fillColor('#64748B').text('No findings.');
      } else {
        for (const f of findings) {
          this.checkPageBreak(doc, 100);
          const sevColor =
            f.severity === 'CRITICAL' ? '#DC2626' :
            f.severity === 'HIGH' ? '#F97316' :
            f.severity === 'MEDIUM' ? '#F59E0B' : '#94A3B8';
          doc.fontSize(9).fillColor(sevColor).text(f.severity, { continued: true });
          doc.fontSize(11).fillColor('#0F172A').text(`  ${f.title}`);
          doc.fontSize(9).fillColor('#475569').text(f.description);
          if (f.evidence?.length) {
            doc.fontSize(8).fillColor('#64748B').text('Evidence:');
            for (const e of f.evidence) {
              doc.fontSize(8).fillColor('#475569').text(`  • ${e}`);
            }
          }
          doc.fontSize(8).fillColor('#94A3B8').text(`Recommendation: ${f.recommendation}`, { oblique: true });
          doc.moveDown(1);
        }
      }
      doc.moveDown(1);

      // Matches
      this.checkPageBreak(doc, 80);
      this.section(doc, 'Cross-source matches');
      const matches = inv.matches || [];
      if (matches.length === 0) {
        doc.fontSize(10).fillColor('#64748B').text('No cross-source matches.');
      } else {
        for (const m of matches) {
          this.checkPageBreak(doc, 40);
          const sourceLabel = m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks';
          doc.fontSize(10).fillColor('#0F172A').text(
            `${m.reasons?.matchedName || m.matchedEntityId}  (${sourceLabel}, ${m.confidence}%)`,
          );
          doc.fontSize(8).fillColor('#64748B').text(`  ${m.sourceEntityType} · ${m.sourceEntityId}`);
          doc.moveDown(0.5);
        }
      }
      doc.moveDown(1);

      // Entity list
      this.checkPageBreak(doc, 80);
      this.section(doc, 'Discovered entities');
      const entities = inv.entities || {};
      for (const type of ['company', 'person', 'address']) {
        const items = (entities as any)[type] || [];
        if (items.length === 0) continue;
        this.checkPageBreak(doc, 40);
        doc.fontSize(10).fillColor('#475569').text(`${type.toUpperCase()}S (${items.length})`);
        for (const e of items.slice(0, 50)) {
          this.checkPageBreak(doc, 14);
          const flag =
            e.proximityScore === 'CRITICAL' ? '!' :
            e.proximityScore === 'HIGH' ? '·' : ' ';
          doc.fontSize(9).fillColor('#0F172A').text(`  ${flag} ${e.label}`);
        }
        if (items.length > 50) {
          doc.fontSize(8).fillColor('#94A3B8').text(`  …and ${items.length - 50} more`);
        }
        doc.moveDown(0.5);
      }

      doc.end();
    });
  }

  private section(doc: any, title: string) {
    doc.fontSize(8).fillColor('#94A3B8').text(title.toUpperCase(), { characterSpacing: 1 });
    doc.moveTo(doc.x, doc.y).lineTo(doc.x + 495, doc.y).strokeColor('#E2E8F0').stroke();
    doc.moveDown(0.5);
  }

  private checkPageBreak(doc: any, needed: number) {
    if (doc.y + needed > doc.page.height - 50) doc.addPage();
  }
}
