import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { Finding } from '../risk-scoring/finding.types';

const USER_AGENT = 'TraceGraph/0.1 (open-source corporate intelligence)';

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((d) => { cache.set(key, { data: d, expiresAt: Date.now() + CACHE_TTL }); return d; });
}

export interface EpaViolation {
  facilityName: string;
  facilityId: string;
  city: string;
  state: string;
  violationType: string;
  programArea: string;
  complianceStatus: string;
  lastInspection: string | null;
  penalties: number;
}

export interface OshaViolation {
  activityNr: string;
  establishmentName: string;
  city: string;
  state: string;
  violationType: string;
  penalty: number;
  inspectionDate: string;
  status: string;
}

/**
 * EPA & OSHA Regulatory Violation Search.
 *
 * 1. EPA ECHO (Enforcement & Compliance History Online) — environmental violations
 * 2. OSHA enforcement data — workplace safety violations
 *
 * Both are free APIs with no key required.
 */
@Injectable()
export class RegulatoryViolationsService {
  private readonly logger = new Logger(RegulatoryViolationsService.name);

  constructor(
    @InjectRepository(GraphNode) private readonly nodes: Repository<GraphNode>,
  ) {}

  async search(
    investigationId: string,
    companyName: string,
  ): Promise<{
    epaViolations: EpaViolation[];
    oshaViolations: OshaViolation[];
    findings: Finding[];
  }> {
    this.logger.log(`Regulatory violations: searching EPA + OSHA for "${companyName}"`);

    const searchName = companyName
      .replace(/\b(INC|CORP|LLC|LTD|PLC|CO)\b\.?/gi, '')
      .replace(/[,.\-]+$/, '')
      .trim();

    const [epaViolations, oshaViolations] = await Promise.all([
      this.searchEpa(searchName).catch((e) => {
        this.logger.warn(`EPA search failed: ${e?.message}`);
        return [] as EpaViolation[];
      }),
      this.searchOsha(searchName).catch((e) => {
        this.logger.warn(`OSHA search failed: ${e?.message}`);
        return [] as OshaViolation[];
      }),
    ]);

    const findings = this.generateFindings(companyName, epaViolations, oshaViolations);

    // Update root node
    try {
      const rootNode = await this.nodes.findOne({
        where: { investigationId, entityType: 'company' },
        order: { id: 'ASC' },
      });
      if (rootNode) {
        const meta = (rootNode.metadata || {}) as any;
        meta.regulatoryViolations = {
          epaCount: epaViolations.length,
          oshaCount: oshaViolations.length,
          totalPenalties: epaViolations.reduce((s, v) => s + v.penalties, 0) +
            oshaViolations.reduce((s, v) => s + v.penalty, 0),
          screenedAt: new Date().toISOString(),
        };
        await this.nodes.update(rootNode.id, { metadata: meta });
      }
    } catch {}

    this.logger.log(
      `Regulatory violations complete: ${epaViolations.length} EPA, ${oshaViolations.length} OSHA, ${findings.length} findings`,
    );

    return { epaViolations, oshaViolations, findings };
  }

  // ═══════════════════════════════════════════
  // EPA ECHO
  // ═══════════════════════════════════════════

  private async searchEpa(name: string): Promise<EpaViolation[]> {
    return cached(`reg:epa:${name.toLowerCase()}`, async () => {
      try {
        // EPA ECHO facility search
        const res = await axios.get('https://echo.epa.gov/dfr/rest/services/get_dfr', {
          params: {
            p_fn: name, // facility name
            p_act: 'Y', // active facilities only
            output: 'JSON',
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const facilities = res.data?.Results?.Facilities || [];
        const violations: EpaViolation[] = [];

        for (const fac of facilities.slice(0, 10)) {
          // Check compliance status
          const status = fac.CWPStatus || fac.RCRAStatus || fac.CAAStatus || '';
          const hasViolation = status.includes('Violation') || status.includes('SNC') || status.includes('HPV');

          if (hasViolation || fac.Penalties > 0) {
            violations.push({
              facilityName: fac.FacName || name,
              facilityId: fac.RegistryID || fac.FacFIPSCode || '',
              city: fac.FacCity || '',
              state: fac.FacState || '',
              violationType: status || 'Unknown',
              programArea: [
                fac.CWPStatus && 'Clean Water',
                fac.RCRAStatus && 'Hazardous Waste',
                fac.CAAStatus && 'Clean Air',
              ].filter(Boolean).join(', ') || 'Environmental',
              complianceStatus: status,
              lastInspection: fac.DateLastInspection || null,
              penalties: fac.Penalties || 0,
            });
          }
        }

        return violations;
      } catch (e: any) {
        // Try alternate EPA endpoint
        try {
          const res = await axios.get('https://echo.epa.gov/dfr/rest/services/get_facilities', {
            params: { p_fn: name, output: 'JSON' },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000,
          });

          const results = res.data?.Results?.ClusterOutput?.FacilityDetails || res.data?.Results?.Facilities || [];
          return results
            .filter((f: any) => f.Violations > 0 || f.Penalties > 0)
            .slice(0, 10)
            .map((f: any) => ({
              facilityName: f.FacName || name,
              facilityId: f.RegistryID || '',
              city: f.FacCity || '',
              state: f.FacState || '',
              violationType: `${f.Violations || 0} violations`,
              programArea: 'Environmental',
              complianceStatus: f.ComplianceStatus || 'Unknown',
              lastInspection: null,
              penalties: f.Penalties || 0,
            }));
        } catch {
          return [];
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // OSHA ENFORCEMENT
  // ═══════════════════════════════════════════

  private async searchOsha(name: string): Promise<OshaViolation[]> {
    return cached(`reg:osha:${name.toLowerCase()}`, async () => {
      try {
        // OSHA enforcement API
        const res = await axios.get('https://enforcedata.dol.gov/api/enhanced/search', {
          params: {
            agency: 'osha',
            q: name,
            size: 10,
          },
          headers: { 'User-Agent': USER_AGENT },
          timeout: 15000,
        });

        const hits = res.data?.hits?.hits || res.data?.results || [];
        return hits.slice(0, 10).map((hit: any) => {
          const src = hit._source || hit;
          return {
            activityNr: src.activity_nr || src.activityNr || '',
            establishmentName: src.estab_name || src.establishment_name || name,
            city: src.site_city || '',
            state: src.site_state || '',
            violationType: src.viol_type || src.violation_type || 'General',
            penalty: src.initial_penalty || src.penalty || 0,
            inspectionDate: src.open_date || src.inspection_date || '',
            status: src.case_status || src.status || 'Unknown',
          };
        });
      } catch {
        // Try alternate format
        try {
          const res = await axios.get(`https://enforcedata.dol.gov/api/osha/inspection`, {
            params: { estab_name: name, limit: 10 },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000,
          });

          const results = res.data?.results || [];
          return results.slice(0, 10).map((r: any) => ({
            activityNr: r.activity_nr || '',
            establishmentName: r.estab_name || name,
            city: r.site_city || '',
            state: r.site_state || '',
            violationType: r.viol_type || 'General',
            penalty: r.total_current_penalty || r.initial_penalty || 0,
            inspectionDate: r.open_date || '',
            status: r.case_status || 'Unknown',
          }));
        } catch {
          return [];
        }
      }
    });
  }

  // ═══════════════════════════════════════════
  // FINDINGS
  // ═══════════════════════════════════════════

  private generateFindings(
    companyName: string,
    epa: EpaViolation[],
    osha: OshaViolation[],
  ): Finding[] {
    const findings: Finding[] = [];

    if (epa.length > 0) {
      const totalPenalties = epa.reduce((s, v) => s + v.penalties, 0);
      findings.push({
        type: 'EPA_VIOLATION',
        severity: totalPenalties > 100000 ? 'HIGH' : epa.length > 3 ? 'HIGH' : 'MEDIUM',
        confidence: 'HIGH',
        title: `${epa.length} EPA environmental violation${epa.length !== 1 ? 's' : ''}${totalPenalties > 0 ? ` ($${totalPenalties.toLocaleString()} in penalties)` : ''}`,
        description: `${companyName} has ${epa.length} environmental violation${epa.length !== 1 ? 's' : ''} recorded in the EPA ECHO database. ` +
          `Program areas: ${[...new Set(epa.map((v) => v.programArea))].join(', ')}. ` +
          `Environmental violations indicate ESG risk and may result in ongoing remediation costs, regulatory scrutiny, and reputational damage.`,
        evidence: epa.slice(0, 5).map((v) =>
          `${v.facilityName} (${v.city}, ${v.state}): ${v.violationType}${v.penalties > 0 ? ` — $${v.penalties.toLocaleString()} penalty` : ''}`,
        ),
        affectedEntities: [],
        recommendation: 'Review EPA enforcement actions for severity and ongoing obligations. Environmental liabilities can be material and transfer with ownership.',
      });
    }

    if (osha.length > 0) {
      const totalPenalties = osha.reduce((s, v) => s + v.penalty, 0);
      findings.push({
        type: 'OSHA_VIOLATION',
        severity: totalPenalties > 50000 ? 'HIGH' : osha.length > 3 ? 'MEDIUM' : 'LOW',
        confidence: 'HIGH',
        title: `${osha.length} OSHA workplace safety violation${osha.length !== 1 ? 's' : ''}${totalPenalties > 0 ? ` ($${totalPenalties.toLocaleString()} in penalties)` : ''}`,
        description: `${companyName} has ${osha.length} workplace safety violation${osha.length !== 1 ? 's' : ''} recorded by OSHA. ` +
          `Violation types: ${[...new Set(osha.map((v) => v.violationType))].join(', ')}. ` +
          `Repeated OSHA violations indicate systemic safety issues and potential liability exposure.`,
        evidence: osha.slice(0, 5).map((v) =>
          `${v.establishmentName} (${v.city}, ${v.state}): ${v.violationType}${v.penalty > 0 ? ` — $${v.penalty.toLocaleString()} penalty` : ''} (${v.inspectionDate})`,
        ),
        affectedEntities: [],
        recommendation: 'Review OSHA inspection history for patterns of non-compliance. Repeated violations may indicate management neglect of worker safety.',
      });
    }

    return findings;
  }
}
