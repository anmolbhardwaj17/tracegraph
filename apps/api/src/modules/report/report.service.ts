import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');
import { InvestigationService } from '../investigation/investigation.service';

const C = {
  black: '#0F172A', dark: '#1E293B', text: '#334155', label: '#475569',
  gray: '#64748B', rule: '#CBD5E1', faint: '#E2E8F0',
  red: '#DC2626', amber: '#D97706', orange: '#EA580C', green: '#059669', blue: '#2563EB',
};

function titleCase(s: string): string { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }
const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
function sevColor(sev: string): string { return sev === 'CRITICAL' ? C.red : sev === 'HIGH' ? C.orange : sev === 'MEDIUM' ? C.amber : C.gray; }
function sevBg(sev: string): string { return sev === 'CRITICAL' ? '#FEE2E2' : sev === 'HIGH' ? '#FFEDD5' : sev === 'MEDIUM' ? '#FEF3C7' : '#F1F5F9'; }

// Consolidate repetitive findings of the same type
function consolidateFindings(findings: any[], entityLabelMap: Map<string, string>): any[] {
  const byType = new Map<string, any[]>();
  for (const f of findings) {
    const list = byType.get(f.type) || [];
    list.push(f);
    byType.set(f.type, list);
  }

  const result: any[] = [];
  for (const [type, group] of byType) {
    if (group.length < 3) {
      // Show individually but resolve entity names
      for (const f of group) result.push(resolveNames(f, entityLabelMap));
      continue;
    }
    // Consolidate into one entry
    const sorted = group.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
    const topSev = sorted[0].severity;
    const consolidated = { ...sorted[0], _consolidated: true, _count: group.length };

    if (type === 'INCESTUOUS_NETWORK') {
      const clusters = group.map((f) => {
        const m = f.title.match(/(\d+) people cross-direct (\d+) companies/);
        return m ? { people: parseInt(m[1]), companies: parseInt(m[2]) } : null;
      }).filter(Boolean);
      const totalCos = new Set(group.flatMap((f: any) => f.affectedEntities || [])).size;
      consolidated.title = `Cross-directorship network detected - ${group.length} clusters identified`;
      consolidated.description = `Multiple groups of directors share appointments across ${totalCos} companies. ` +
        clusters.slice(0, 3).map((c: any, i: number) => `Cluster ${i + 1}: ${c.people} people, ${c.companies} companies`).join('. ') +
        (clusters.length > 3 ? `. And ${clusters.length - 3} more clusters.` : '.');
    } else if (type === 'SHELL_NETWORK') {
      consolidated.title = `${group.length} entities flagged as potential shell companies`;
      const names = group.slice(0, 5).map((f: any) => {
        const eid = f.affectedEntities?.[0];
        return eid ? (entityLabelMap.get(eid) || eid) : 'Unknown';
      });
      consolidated.description = `Shell indicators detected on: ${names.join(', ')}${group.length > 5 ? ` and ${group.length - 5} more` : ''}.`;
    } else if (type === 'SAME_SIC_CONFLICT') {
      consolidated.title = `${group.length} same-industry conflicts detected`;
      consolidated.description = `Directors of the target company also direct competing companies in the same SIC codes, creating potential conflicts of interest.`;
    } else if (type === 'RESIGNATION_CLUSTER') {
      consolidated.title = `${group.length} resignation cluster events detected`;
      consolidated.description = `Multiple directors resigned within short time windows, which may indicate awareness of adverse events or coordinated departures.`;
    } else {
      consolidated.title = `${group.length} ${type.replace(/_/g, ' ').toLowerCase()} findings`;
      consolidated.description = `${group.length} instances of this finding type were detected across the network. Top severity: ${topSev}.`;
    }
    result.push(consolidated);
  }
  return result.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
}

function resolveNames(finding: any, map: Map<string, string>): any {
  let title = finding.title;
  // Replace company-number-like patterns with resolved names
  for (const [id, label] of map) {
    if (title.includes(id) && id !== label) title = title.replace(id, label);
  }
  return { ...finding, title };
}

// Generate key conclusions from findings
function generateConclusions(
  targetFindings: any[], directorFindings: any[], networkFindings: any[],
  meta: any, leadership: any[], matches: any[], companyName: string,
): string[] {
  const conclusions: string[] = [];
  const all = [...targetFindings, ...directorFindings, ...networkFindings];

  // Company status
  if (meta.status && meta.status !== 'active') {
    conclusions.push(`Company status: ${companyName} is currently ${titleCase(meta.status)}, which ${meta.status === 'administration' || meta.status === 'liquidation' ? 'confirms the risk signals detected in this investigation' : 'requires additional verification'}.`);
  }

  // Director network
  const incestuous = all.filter((f) => f.type === 'INCESTUOUS_NETWORK');
  if (incestuous.length > 0) {
    const totalCompanies = new Set(incestuous.flatMap((f: any) => f.affectedEntities || [])).size;
    conclusions.push(`Director network opacity: ${companyName}'s directors collectively control ${totalCompanies}+ companies through overlapping appointments, creating a complex web that obscures the true scope of operations.`);
  }

  // Resignation clusters
  const resignations = all.filter((f) => f.type === 'RESIGNATION_CLUSTER');
  if (resignations.length >= 2) {
    conclusions.push(`Mass resignations detected: Multiple directors resigned within short time windows, suggesting coordinated departures or awareness of impending adverse events.`);
  }

  // High dissolution directors
  const highDissolution = leadership.filter((p) => (p.metadata?.directorProfile?.dissolved || 0) >= 10);
  if (highDissolution.length > 0) {
    const names = highDissolution.map((p: any) => `${p.label} (${p.metadata.directorProfile.dissolved} dissolved)`).join(', ');
    conclusions.push(`Concerning director track records: ${names}. High dissolution counts may indicate a pattern of short-lived corporate vehicles.`);
  }

  // Sanctions
  if (matches.length > 0) {
    conclusions.push(`Cross-source screening: ${matches.length} match${matches.length > 1 ? 'es' : ''} found against international sanctions and offshore entity databases. Independent verification of each match is recommended.`);
  }

  // Ownership opacity
  if (meta.ownershipOpacity?.band === 'OPAQUE' || meta.ownershipOpacity?.score >= 60) {
    conclusions.push(`Ownership transparency concerns: Beneficial ownership structure scored ${meta.ownershipOpacity.score}/100 for opacity. ${meta.ownershipOpacity.reasons?.[0] || 'Corporate PSC structures may obscure ultimate control.'}`);
  }

  // Shell risk
  if (meta.shellCompanyScore?.risk === 'HIGH' || meta.shellCompanyScore?.risk === 'CRITICAL') {
    conclusions.push(`Shell company indicators: The target company itself scored ${meta.shellCompanyScore.score}/100 on shell company heuristics, indicating limited genuine trading activity.`);
  }

  // Clean bill
  if (conclusions.length === 0) {
    conclusions.push(`No significant concerns were identified. ${companyName} presents a low-risk profile based on available public data.`);
  }

  return conclusions.slice(0, 5);
}

@Injectable()
export class ReportService {
  constructor(private readonly investigations: InvestigationService) {}

  async generatePdf(investigationId: string): Promise<Buffer> {
    const inv = await this.investigations.findOne(investigationId);
    const relations = await this.investigations.computeRelationsPublic(investigationId);
    let benchmarkPct: number | null = null;
    try { benchmarkPct = await this.investigations.getPercentile(inv.riskScore ?? 0); } catch {}

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 60, right: 60 }, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 475; const L = 60; const R = 535;
      const companyName = inv.companyName || inv.query;
      const findings = inv.findings || [];
      const entities = inv.entities || {};
      const matches = inv.matches || [];
      const uboChains = inv.uboChains || [];
      const score = inv.riskScore ?? 0;
      const counts = inv.counts || {};

      // Build entity label map for name resolution
      const entityLabelMap = new Map<string, string>();
      for (const group of ['company', 'person', 'address']) {
        for (const e of (entities as any)[group] || []) {
          if (e.entityId) entityLabelMap.set(e.entityId, e.label);
          if (e.id) entityLabelMap.set(e.id, e.label);
        }
      }

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
      const leadership = (entities.person || []).filter((p: any) => {
        const r = relations.get(p.id); return r === 'Director' || r === 'PSC/Owner';
      });

      // Consolidate findings for PDF
      const consolidatedTarget = consolidateFindings(targetFindings, entityLabelMap);
      const consolidatedDirector = consolidateFindings(directorFindings, entityLabelMap);
      const consolidatedNetwork = consolidateFindings(networkFindings, entityLabelMap);

      // ===================== PAGE 1 — COVER =====================
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
        `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}  ·  Report ID: ${investigationId.slice(0, 8)}`, { align: 'center' });
      doc.fontSize(8).fillColor(C.gray).text('Generated by TraceGraph', { align: 'center' });

      // ===================== PAGE 2 — EXECUTIVE SUMMARY =====================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Executive Summary');
      doc.moveDown(0.8);

      const age = meta.incorporationDate ? Math.floor((Date.now() - new Date(meta.incorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
      const sp: string[] = [];
      sp.push(`${companyName} is ${meta.status === 'active' ? 'an active' : 'a ' + titleCase(meta.status || 'registered')} ${titleCase(meta.companyType || 'company')}`);
      if (age !== null) sp.push(`incorporated ${age} years ago`);
      sp.push(`with ${leadership.length} directors/PSCs and a network of ${(counts.companies || 0).toLocaleString()} connected companies.`);
      if (targetFindings.length > 0) sp.push(`${targetFindings.length} risk signals were detected directly on the target company.`);
      else sp.push('No risk signals were detected directly on the target company.');
      if (matches.length > 0) sp.push(`${matches.length} cross-source match${matches.length > 1 ? 'es' : ''} found against sanctions or offshore databases.`);
      doc.font('Helvetica').fontSize(10.5).fillColor(C.text).text(sp.join(' '), { lineGap: 4 });
      doc.moveDown(1.5);

      // Verdict
      const verdict = score >= 75 ? { label: 'DO NOT PROCEED WITHOUT LEGAL REVIEW', color: C.red }
        : score >= 50 ? { label: 'ENHANCED DUE DILIGENCE RECOMMENDED', color: C.orange }
        : score >= 25 ? { label: 'PROCEED WITH CAUTION', color: C.amber }
        : { label: 'PROCEED', color: C.green };
      const vY = doc.y;
      doc.rect(L, vY, W, 40).fill(verdict.color);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#FFFFFF').text(verdict.label, L, vY + 13, { width: W, align: 'center' });
      doc.y = vY + 48;

      // Benchmark context
      const riskLabel = score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'ELEVATED' : 'LOW';
      doc.font('Helvetica').fontSize(9).fillColor(C.label).text(
        `This company's risk score of ${score} places it in the ${riskLabel} category.` +
        (benchmarkPct != null && benchmarkPct > 0 ? ` Higher than ${benchmarkPct}% of companies analyzed on TraceGraph.` : ''),
      );
      doc.moveDown(1);

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

      // ===================== PAGE 3 — KEY CONCLUSIONS =====================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Key Conclusions');
      doc.moveDown(0.8);

      const conclusions = generateConclusions(targetFindings, directorFindings, networkFindings, meta, leadership, matches, companyName);
      for (let i = 0; i < conclusions.length; i++) {
        this.checkPageBreak(doc, 40, companyName);
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(`${i + 1}.`, L, y, { width: 20 });
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(conclusions[i], L + 22, y, { width: W - 22, lineGap: 3 });
        doc.moveDown(1.2);
      }

      // ===================== PAGE 4 — OWNERSHIP =====================
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
          doc.font('Helvetica-Bold').fontSize(12).fillColor(C.black).text('Ultimate Beneficial Owner');
          doc.font('Helvetica-Bold').fontSize(11).fillColor(C.dark).text(ubo?.name || 'Unknown');
          if (chain.effectiveOwnershipPct != null) doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`${chain.effectiveOwnershipPct}% effective ownership`);
          doc.moveDown(1.2);
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            const indent = i * 24; const x = L + 10 + indent;
            if (i > 0) { doc.font('Helvetica').fontSize(10).fillColor(C.rule).text('|', x - 6, doc.y); doc.moveDown(0.1); doc.font('Helvetica').fontSize(10).fillColor(C.rule).text('|___', x - 6, doc.y, { continued: true }); doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(` ${node.name}`); }
            else doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(node.name, x);
            const details: string[] = [node.kind === 'person' ? 'Natural Person' : 'Company'];
            if (node.ownershipPct) details.push(`${node.ownershipPct}% ownership`);
            if (node.jurisdiction) details.push(node.jurisdiction);
            if (node.companyNumber) details.push(node.companyNumber);
            doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(details.join('  ·  '), x + (i > 0 ? 20 : 0));
            doc.moveDown(0.8);
          }
          doc.moveDown(0.5);
          if (chain.terminationReason) doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`Chain resolved: ${chain.terminationReason}`);
          doc.moveDown(2.5);
        }
      }

      // ===================== PAGE 5 — LEADERSHIP =====================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Leadership Assessment');
      doc.moveDown(0.8);

      if (leadership.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(C.gray).text('No direct directors or PSCs found.');
      } else {
        const hY = doc.y;
        doc.rect(L, hY, W, 20).fill('#F1F5F9');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.label);
        doc.text('NAME', L + 5, hY + 6, { width: 155 }); doc.text('ROLE', L + 160, hY + 6, { width: 55 });
        doc.text('NATIONALITY', L + 215, hY + 6, { width: 70 }); doc.text('TRACK RECORD', L + 285, hY + 6, { width: 100 });
        doc.text('RISK', L + 390, hY + 6, { width: 85 });
        doc.y = hY + 24;

        for (const person of leadership) {
          this.checkPageBreak(doc, 32, companyName);
          const pmeta = person.metadata || {};
          const dp = pmeta.directorProfile || {};
          const rel = relations.get(person.id) || 'Director';
          const role = rel === 'PSC/Owner' ? 'PSC' : 'Director';
          const dissolved = dp.dissolved || 0;
          const risk = dp.risk && dp.risk !== 'NORMAL' ? dp.risk.replace(/_/g, ' ') : '-';
          const riskColor = (dp.risk === 'NOMINEE_PATTERN' || dp.risk === 'FORMATION_AGENT') ? C.red : C.text;
          const track = dp.totalAppointments ? `${dp.active || 0} active, ${dissolved} dissolved` : '-';
          const trackColor = dissolved >= 10 ? C.red : C.text;

          const y = doc.y;
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.dark).text(person.label, L + 5, y, { width: 155 });
          doc.font('Helvetica').fontSize(8).fillColor(role === 'PSC' ? C.orange : C.label).text(role, L + 160, y, { width: 55 });
          doc.font('Helvetica').fontSize(8).fillColor(C.text).text(pmeta.nationality || '-', L + 215, y, { width: 70 });
          doc.font('Helvetica-Bold').fontSize(8).fillColor(trackColor).text(track, L + 285, y, { width: 100 });
          doc.font('Helvetica-Bold').fontSize(8).fillColor(riskColor).text(risk, L + 390, y, { width: 85 });
          doc.y = Math.max(doc.y, y + 16);

          // Flags
          if (dissolved >= 10) {
            doc.font('Helvetica-Bold').fontSize(7).fillColor(C.red).text(`  ⚠ High dissolution count (${dissolved} companies)`, L + 5);
          }
          if (person.matches?.length > 0) {
            doc.font('Helvetica-Bold').fontSize(7).fillColor(C.red).text(
              `  ⚠ SANCTIONS MATCH: ${person.matches.map((m: any) => `${m.reasons?.matchedName || m.matchedEntityId} (${m.confidence}%)`).join(', ')}`, L + 5);
          }
          doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).strokeColor(C.faint).stroke();
          doc.y += 6;
        }
      }

      // ===================== PAGE 6+ — FINDINGS =====================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, `Findings on ${companyName}`);
      doc.moveDown(0.5);

      if (consolidatedTarget.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text(`No risk signals detected directly on ${companyName}.`);
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(`${targetFindings.length} finding${targetFindings.length > 1 ? 's' : ''} (${consolidatedTarget.length} consolidated):`);
        doc.moveDown(0.8);
        this.renderFindings(doc, consolidatedTarget.slice(0, 10), companyName);
        if (consolidatedTarget.length > 10) doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`  + ${consolidatedTarget.length - 10} more`);
      }
      doc.moveDown(2); doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke(); doc.moveDown(1.5);

      this.checkPageBreak(doc, 100, companyName);
      this.sectionTitle(doc, 'Findings on Directors');
      doc.moveDown(0.5);
      if (consolidatedDirector.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text('No risk signals on target company directors.');
      } else {
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(`${directorFindings.length} finding${directorFindings.length > 1 ? 's' : ''} (${consolidatedDirector.length} consolidated):`);
        doc.moveDown(0.8);
        this.renderFindings(doc, consolidatedDirector.slice(0, 8), companyName);
        if (consolidatedDirector.length > 8) doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`  + ${consolidatedDirector.length - 8} more`);
      }
      doc.moveDown(2); doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke(); doc.moveDown(1.5);

      this.checkPageBreak(doc, 100, companyName);
      this.sectionTitle(doc, 'Network Findings Summary');
      doc.moveDown(0.5);
      if (consolidatedNetwork.length === 0) {
        doc.font('Helvetica-Bold').fontSize(10).fillColor(C.green).text('No findings in the wider network.');
      } else {
        const nCrit = networkFindings.filter((f: any) => f.severity === 'CRITICAL').length;
        const nHigh = networkFindings.filter((f: any) => f.severity === 'HIGH').length;
        doc.font('Helvetica').fontSize(10).fillColor(C.text).text(
          `${networkFindings.length.toLocaleString()} findings (${consolidatedNetwork.length} consolidated, ${nCrit} critical, ${nHigh} high). Top 5:`);
        doc.moveDown(0.8);
        this.renderFindings(doc, consolidatedNetwork.slice(0, 5), companyName);
      }

      // Matches
      if (matches.length > 0) {
        doc.moveDown(2); this.checkPageBreak(doc, 80, companyName);
        this.sectionTitle(doc, 'Cross-Source Matches');
        doc.moveDown(0.5);
        for (const m of matches.slice(0, 10)) {
          this.checkPageBreak(doc, 30, companyName);
          const src = m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks';
          const entityLabel = entityLabelMap.get(m.sourceEntityId) || m.sourceEntityId;
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(m.reasons?.matchedName || m.matchedEntityId, { continued: true });
          doc.font('Helvetica-Bold').fontSize(9).fillColor(m.confidence >= 75 ? C.red : C.amber).text(`  ${m.confidence}%`, { continued: true });
          doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`  ${src}`);
          if (entityLabel !== m.sourceEntityId) doc.font('Helvetica').fontSize(8).fillColor(C.gray).text(`  Matched entity: ${entityLabel}`);
          doc.moveDown(0.4);
        }
      }

      // ===================== INTELLIGENCE REPORT =====================
      const progress = inv.progress || {} as any;
      const narrative = progress.narrative;
      const pepCount = progress.pepCount || 0;
      const adverseMediaCount = progress.adverseMediaCount || 0;
      const secIntel = progress.secIntelligence;
      const webIntel = progress.webIntelligence;
      const wayback = progress.wayback;
      const politicalDonations = progress.politicalDonations;
      const fatfFlags = progress.fatfFlags || 0;

      if (narrative || pepCount > 0 || secIntel || webIntel) {
        doc.addPage();
        this.pageHeader(doc, companyName);
        this.sectionTitle(doc, 'Intelligence Report');
        doc.moveDown(0.8);

        // AI Narrative
        if (narrative?.executiveSummary) {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text('AI Risk Assessment');
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(10).fillColor(C.text).text(narrative.executiveSummary, { lineGap: 3 });
          doc.moveDown(1);

          if (narrative.keyFindings?.length > 0) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(C.label).text('KEY FINDINGS:', { characterSpacing: 1 });
            doc.moveDown(0.3);
            for (const f of narrative.keyFindings) {
              doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`•  ${f}`, { indent: 10, lineGap: 2 });
            }
            doc.moveDown(0.8);
          }

          if (narrative.recommendations?.length > 0) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(C.label).text('RECOMMENDATIONS:', { characterSpacing: 1 });
            doc.moveDown(0.3);
            for (let i = 0; i < narrative.recommendations.length; i++) {
              doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`${i + 1}. ${narrative.recommendations[i]}`, { indent: 10, lineGap: 2 });
            }
            doc.moveDown(0.8);
          }
          doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke();
          doc.moveDown(1);
        }

        // PEP Warnings
        if (pepCount > 0) {
          this.checkPageBreak(doc, 60, companyName);
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.red).text(`⚠ ${pepCount} Politically Exposed Person${pepCount !== 1 ? 's' : ''} Detected`);
          doc.moveDown(0.3);
          if (narrative?.pepWarnings) {
            for (const w of narrative.pepWarnings) {
              doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`•  ${w}`, { indent: 10, lineGap: 2 });
            }
          }
          doc.font('Helvetica').fontSize(8).fillColor(C.label).text('PEP status requires enhanced due diligence under AML/KYC regulations.');
          doc.moveDown(1);
          doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke();
          doc.moveDown(1);
        }

        // Financial Health
        if (secIntel?.financials) {
          this.checkPageBreak(doc, 80, companyName);
          const fin = secIntel.financials;
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text('Financial Health');
          doc.moveDown(0.3);
          const finFields: [string, string][] = [];
          if (fin.profitMargin != null) finFields.push(['Profit Margin', `${fin.profitMargin}%`]);
          if (fin.debtToEquity != null) finFields.push(['Debt-to-Equity', String(fin.debtToEquity)]);
          if (fin.currentRatio != null) finFields.push(['Current Ratio', String(fin.currentRatio)]);
          if (fin.flags?.length > 0) finFields.push(['Flags', fin.flags.join(', ')]);
          for (const [label, value] of finFields) this.fieldRow(doc, label, value);
          doc.moveDown(0.8);
          if (secIntel.materialEvents > 0) {
            doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`${secIntel.materialEvents} material events (8-K filings) in the last 6 months.`);
          }
          if (secIntel.insiderSignal && secIntel.insiderSignal !== 'BALANCED') {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(C.amber).text(`Insider trading signal: ${secIntel.insiderSignal} (${secIntel.insiderSignalStrength})`);
          }
          doc.moveDown(1);
          doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.faint).stroke();
          doc.moveDown(1);
        }

        // Web Intelligence
        if (webIntel) {
          this.checkPageBreak(doc, 60, companyName);
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text('Web & Legal Intelligence');
          doc.moveDown(0.3);
          this.fieldRow(doc, 'Website', webIntel.websiteExists ? 'Verified' : 'Not Found');
          if (wayback?.firstSnapshot) this.fieldRow(doc, 'Online Since', wayback.firstSnapshot);
          if (wayback?.domainAgeYears != null) this.fieldRow(doc, 'Domain Age', `${wayback.domainAgeYears} years`);
          this.fieldRow(doc, 'Federal Court Cases', String(webIntel.courtCases || 0));
          this.fieldRow(doc, 'Government Contracts', String(webIntel.govContracts || 0));
          doc.moveDown(1);
        }

        // Political Donations
        if (politicalDonations?.totalDonations > 0) {
          this.checkPageBreak(doc, 40, companyName);
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text('Political Donations (FEC)');
          doc.moveDown(0.3);
          this.fieldRow(doc, 'Total Donations', String(politicalDonations.totalDonations));
          this.fieldRow(doc, 'Total Amount', `$${politicalDonations.totalAmount.toLocaleString()}`);
          doc.moveDown(1);
        }

        // FATF Jurisdiction Flags
        if (fatfFlags > 0) {
          this.checkPageBreak(doc, 40, companyName);
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.orange).text(`⚠ ${fatfFlags} High-Risk Jurisdiction${fatfFlags !== 1 ? 's' : ''} (FATF)`);
          doc.moveDown(0.3);
          doc.font('Helvetica').fontSize(9).fillColor(C.text).text('Entities in the network operate in FATF grey/blacklisted or known secrecy jurisdictions.', { lineGap: 2 });
          doc.moveDown(1);
        }

        // Adverse Media
        if (adverseMediaCount > 0 && narrative?.adverseMedia?.length > 0) {
          this.checkPageBreak(doc, 60, companyName);
          doc.font('Helvetica-Bold').fontSize(10).fillColor(C.amber).text(`Adverse Media (${adverseMediaCount} hits)`);
          doc.moveDown(0.3);
          for (const m of narrative.adverseMedia.slice(0, 5)) {
            doc.font('Helvetica').fontSize(9).fillColor(C.text).text(`•  ${m}`, { indent: 10, lineGap: 2 });
          }
          doc.moveDown(1);
        }
      }

      // ===================== FINAL PAGE — METHODOLOGY =====================
      doc.addPage();
      this.pageHeader(doc, companyName);
      this.sectionTitle(doc, 'Methodology & Sources');
      doc.moveDown(0.8);
      doc.font('Helvetica').fontSize(10).fillColor(C.text).text('This report was generated using publicly available data from the following sources:', { lineGap: 3 });
      const invJurisdiction = inv.metadata?.jurisdiction || 'gb';
      if (invJurisdiction !== 'gb') {
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9).fillColor(C.amber).text(
          'Note: Data depth varies by jurisdiction. UK investigations use Companies House for comprehensive analysis. ' +
          'Other jurisdictions use OpenCorporates and may have limited data availability for filing health, ownership chains, and PSC data.',
          { lineGap: 2 },
        );
      }
      doc.moveDown(0.8);
      for (const [name, desc] of [
        ['UK Companies House API', 'Company profiles, officers, PSCs, filing history, charges, registered offices'],
        ['US SEC EDGAR', 'Company profiles, Form 4 officers, 10-K filings, 8-K events, XBRL financials'],
        ['GLEIF', 'Legal Entity Identifiers, ownership chains, parent/subsidiary relationships'],
        ['Wikidata', 'Headquarters, key people, subsidiaries, industry, revenue, employee count'],
        ['OFAC SDN', 'US Treasury Specially Designated Nationals sanctions list (26,000+ entities)'],
        ['UK HMT', 'UK Treasury consolidated sanctions list (12,000+ entities)'],
        ['OpenSanctions', '4.1 million sanctions, PEP, and watchlist entities from 100+ global sources'],
        ['ICIJ OffshoreLeaks', '770,000+ offshore entities, officers, and intermediaries'],
        ['CourtListener', 'US federal court records and docket information'],
        ['FEC', 'Federal Election Commission political contribution records'],
        ['Wayback Machine', 'Internet Archive historical website snapshots'],
        ['FATF', 'Financial Action Task Force grey/blacklist jurisdiction ratings'],
        ['GDELT', 'Global news and adverse media monitoring'],
      ]) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.dark).text(name as string, { continued: true });
        doc.font('Helvetica').fontSize(9).fillColor(C.label).text(`  -  ${desc}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(1.5);
      this.sectionTitle(doc, 'Risk Scoring');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(9).fillColor(C.text).text('The risk score (0-100) is computed from 30+ automated detectors plus intelligence signals including PEP detection, sanctions screening, adverse media, insider trading analysis, financial health ratios, litigation history, and FATF jurisdiction risk.', { lineGap: 3 });
      doc.moveDown(1);
      for (const s of [{ range: '0-24', label: 'Low Risk', color: C.green, desc: 'No significant concerns' }, { range: '25-49', label: 'Elevated', color: C.amber, desc: 'Some signals warrant review' }, { range: '50-74', label: 'High', color: C.orange, desc: 'Enhanced due diligence recommended' }, { range: '75-100', label: 'Critical', color: C.red, desc: 'Do not proceed without legal review' }]) {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(s.color).text(`${s.range}  ${s.label}`, { continued: true });
        doc.font('Helvetica').fillColor(C.text).text(`  -  ${s.desc}`);
        doc.moveDown(0.3);
      }
      doc.moveDown(2);
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor(C.rule).stroke();
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.label).text('DISCLAIMER');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(8).fillColor(C.gray).text('This report is generated from publicly available data and automated analysis. It does not constitute legal, financial, or professional advice. Independent verification of all findings is recommended.', { lineGap: 2 });
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(8).fillColor(C.label).text(`Report generated ${new Date().toISOString().slice(0, 10)}  ·  Investigation ${investigationId.slice(0, 8)}  ·  TraceGraph v1.0`);

      // Page numbers
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(7).fillColor(C.gray).text(`Page ${i + 1} of ${pages.count}`, 0, doc.page.height - 40, { width: doc.page.width, align: 'center' });
        if (i > 0) doc.font('Helvetica').fontSize(7).fillColor(C.gray).text('TraceGraph Confidential', L, doc.page.height - 40);
      }
      doc.end();
    });
  }

  private renderFindings(doc: any, findings: any[], companyName: string) {
    const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
    for (let fi = 0; fi < sorted.length; fi++) {
      const f = sorted[fi];
      this.checkPageBreak(doc, 80, companyName);
      const y = doc.y;
      const badgeW = 55;
      doc.rect(60, y, badgeW, 16).fill(sevBg(f.severity));
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(sevColor(f.severity)).text(f.severity, 60, y + 4, { width: badgeW, align: 'center' });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.dark).text(f.title, 60 + badgeW + 8, y + 1, { width: 475 - badgeW - 8 });
      doc.y = Math.max(doc.y, y + 20);
      doc.moveDown(0.3);
      const desc = (f.description || '').slice(0, 300) + (f.description?.length > 300 ? '...' : '');
      doc.font('Helvetica').fontSize(9).fillColor(C.text).text(desc, { lineGap: 2 });
      doc.moveDown(0.3);
      if (f.businessImpact) { doc.font('Helvetica').fontSize(8).fillColor(C.label).text(`Impact: ${f.businessImpact.slice(0, 200)}${f.businessImpact.length > 200 ? '...' : ''}`); }
      if (f.verificationLinks?.length > 0) {
        for (const link of f.verificationLinks) doc.font('Helvetica').fontSize(8).fillColor(C.blue).text(link.label, { link: link.url, underline: true });
      }
      doc.moveDown(1);
      if (fi < sorted.length - 1) { doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor(C.faint).stroke(); doc.moveDown(1); }
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
    const colW = 475 / stats.length; const y = doc.y;
    doc.rect(60, y - 4, 475, 40).fill('#F8FAFC');
    for (let i = 0; i < stats.length; i++) {
      const x = 60 + i * colW + 8;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(C.black).text(stats[i].value, x, y, { width: colW - 8 });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.label).text(stats[i].label, x, y + 20, { width: colW - 8, characterSpacing: 0.8 });
    }
    doc.y = y + 44;
  }

  private checkPageBreak(doc: any, needed: number, companyName: string) {
    if (doc.y + needed > doc.page.height - 60) { doc.addPage(); this.pageHeader(doc, companyName); }
  }
}
