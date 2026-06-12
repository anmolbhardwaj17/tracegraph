'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GraphVisualization, GraphNode } from '../../../../components/GraphVisualization';
import { Avatar } from '../../../../components/Avatar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export default function GraphPage() {
  const { id } = useParams() as { id: string };
  const [graph, setGraph] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/graph`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/findings`).then((r) => r.json()),
    ])
      .then(([g, f]) => { setGraph(g); setFindings(f.findings || []); })
      .catch(() => {});
  }, [id]);

  if (!graph) return <div className="animate-pulse h-[760px] bg-white/5 rounded-sm" />;

  return (
    <div className="relative -mx-8">
      <GraphVisualization
        nodes={graph.nodes}
        links={graph.links}
        findings={findings}
        rootNodeId={graph.rootNodeId}
        height={760}
        onNodeClick={setSelected}
      />

      {/* Entity detail panel */}
      {selected && (
        <aside className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] overflow-auto border border-white/10 bg-ink-900/95 backdrop-blur-md p-5 shadow-2xl z-20">
          <div className="flex items-start justify-between mb-3">
            <div className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
              selected.entityType === 'company' ? 'bg-[#F5C518]/10 text-[#F5C518] border-[#F5C518]/30' :
              selected.entityType === 'person' ? 'bg-[#5EE6A1]/10 text-[#5EE6A1] border-[#5EE6A1]/30' :
              'bg-white/5 text-ink-400 border-white/10'
            }`}>{selected.entityType}</div>
            <button onClick={() => setSelected(null)} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">x</button>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <Avatar name={selected.label} type={selected.entityType as any} size={40} />
            <h3 className="font-medium text-ink-50 break-words text-sm flex-1">{selected.label}</h3>
          </div>

          {/* Risk indicators */}
          <div className="flex gap-2 flex-wrap mt-3">
            {selected.hasMatch && <Badge color="critical">Sanctions match</Badge>}
            {selected.shellRisk && selected.shellRisk !== 'LOW' && <Badge color={selected.shellRisk === 'CRITICAL' ? 'critical' : 'warning'}>Shell: {selected.shellRisk}</Badge>}
            {selected.proximityScore && selected.proximityScore !== 'CLEAR' && <Badge color="warning">Proximity: {selected.proximityScore}</Badge>}
            {selected.isFormationAgent && <Badge color="info">Formation agent</Badge>}
            {selected.jurisdictionRisk === 'HIGH' && <Badge color="critical">{selected.jurisdictionName}</Badge>}
          </div>

          {/* Company details */}
          {selected.entityType === 'company' && selected.metadata && (
            <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Company details</div>
              {selected.metadata.status && <Field label="Status" value={titleCase(selected.metadata.status)} highlight={selected.metadata.status === 'dissolved'} />}
              {selected.metadata.companyType && <Field label="Type" value={selected.metadata.companyType} />}
              {selected.metadata.incorporationDate && <Field label="Incorporated" value={selected.metadata.incorporationDate.slice(0, 10)} />}
              {selected.metadata.dissolutionDate && <Field label="Dissolved" value={selected.metadata.dissolutionDate.slice(0, 10)} highlight />}
              {selected.metadata.jurisdiction && <Field label="Jurisdiction" value={selected.metadata.jurisdiction} />}
              {selected.metadata.sicCodes?.length > 0 && <Field label="SIC codes" value={selected.metadata.sicCodes.join(', ')} />}
              {selected.metadata.accountsType && <Field label="Accounts type" value={selected.metadata.accountsType} />}
              {selected.metadata.confirmationStatementOverdue && <Field label="Conf. statement" value="Overdue" highlight />}
              {selected.metadata.hasBeenLiquidated && <Field label="Liquidated" value="Yes" highlight />}
              {selected.metadata.hasInsolvencyHistory && <Field label="Insolvency" value="Yes" highlight />}
            </div>
          )}

          {/* Company scores */}
          {selected.entityType === 'company' && selected.metadata && (
            <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Risk scores</div>
              {selected.metadata.shellCompanyScore && (
                <Field label="Shell score" value={`${selected.metadata.shellCompanyScore.score}/100 (${selected.metadata.shellCompanyScore.risk})`} highlight={selected.metadata.shellCompanyScore.risk !== 'LOW'} />
              )}
              {selected.metadata.companyProfile && <Field label="Profile" value={titleCase(selected.metadata.companyProfile)} />}
              {selected.metadata.ownershipOpacity && (
                <Field label="Opacity" value={`${selected.metadata.ownershipOpacity.score}/100 (${selected.metadata.ownershipOpacity.band})`} highlight={selected.metadata.ownershipOpacity.score > 50} />
              )}
              {selected.metadata.filingHealth && (
                <Field label="Filing health" value={`${selected.metadata.filingHealth.score}/100 (${selected.metadata.filingHealth.band})`} highlight={selected.metadata.filingHealth.band === 'POOR'} />
              )}
              {selected.metadata.chargesCount != null && <Field label="Charges" value={String(selected.metadata.chargesCount)} />}
            </div>
          )}

          {/* Person details */}
          {selected.entityType === 'person' && selected.metadata && (
            <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Director details</div>
              {selected.metadata.nationality && <Field label="Nationality" value={selected.metadata.nationality} />}
              {selected.metadata.dateOfBirth && <Field label="Born" value={`${selected.metadata.dateOfBirth.month}/${selected.metadata.dateOfBirth.year}`} />}
              {selected.metadata.occupation && <Field label="Occupation" value={selected.metadata.occupation} />}
              {selected.metadata.kind && <Field label="PSC type" value={titleCase(selected.metadata.kind)} />}
              {selected.metadata.naturesOfControl?.length > 0 && (
                <Field label="Control" value={selected.metadata.naturesOfControl.map((c: string) => titleCase(c.replace(/-/g, ' '))).join(', ')} />
              )}
            </div>
          )}

          {/* Person risk scores */}
          {selected.entityType === 'person' && selected.metadata && (
            <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Risk profile</div>
              {selected.metadata.directorProfile && (
                <>
                  <Field label="Risk" value={selected.metadata.directorProfile.risk} highlight={selected.metadata.directorProfile.risk !== 'NORMAL'} />
                  <Field label="Appointments" value={String(selected.metadata.directorProfile.totalAppointments || 0)} />
                  <Field label="Dissolved companies" value={String(selected.metadata.directorProfile.dissolved || 0)} highlight={(selected.metadata.directorProfile.dissolved || 0) > 3} />
                </>
              )}
              {selected.metadata.directorVelocity && (
                <>
                  <Field label="Velocity" value={`${selected.metadata.directorVelocity.appointmentsPerYear}/year`} highlight={selected.metadata.directorVelocity.flagged} />
                  <Field label="Resignation rate" value={`${selected.metadata.directorVelocity.resignationRate}%`} highlight={selected.metadata.directorVelocity.resignationRate > 70} />
                  <Field label="Avg tenure" value={`${selected.metadata.directorVelocity.avgTenureMonths} months`} highlight={selected.metadata.directorVelocity.avgTenureMonths < 12} />
                </>
              )}
              {selected.metadata.disqualifications?.length > 0 && (
                <Field label="Disqualified" value={`Yes (${selected.metadata.disqualifications[0].confidence}% match)`} highlight />
              )}
            </div>
          )}

          {/* Address details */}
          {selected.entityType === 'address' && selected.metadata && (
            <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Address details</div>
              {selected.metadata.addressAnalysis && (
                <>
                  <Field label="Classification" value={titleCase(selected.metadata.addressAnalysis.classification || 'Normal')} highlight={selected.metadata.addressAnalysis.classification === 'VIRTUAL_OFFICE'} />
                  <Field label="Companies here" value={String(selected.metadata.addressAnalysis.density || 0)} highlight={(selected.metadata.addressAnalysis.density || 0) >= 5} />
                  {selected.metadata.addressAnalysis.dissolutionRate != null && (
                    <Field label="Dissolution rate" value={`${Math.round(selected.metadata.addressAnalysis.dissolutionRate * 100)}%`} highlight={selected.metadata.addressAnalysis.dissolutionRate > 0.5} />
                  )}
                </>
              )}
              {selected.metadata.geo && (
                <Field label="Coordinates" value={`${selected.metadata.geo.lat?.toFixed(4)}, ${selected.metadata.geo.lng?.toFixed(4)}`} />
              )}
            </div>
          )}

          {/* Cross-investigations */}
          {selected.metadata?.crossInvestigations?.length > 0 && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Also seen in</div>
              <ul className="space-y-1">
                {selected.metadata.crossInvestigations.map((ci: any, i: number) => (
                  <li key={i} className="text-xs text-ink-300">{ci.companyName} (score {ci.riskScore})</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-white/5 text-[10px] font-mono text-ink-600">
            {selected.degree} connections
          </div>

          {selected.entityType === 'company' && (
            <a href={`/?q=${selected.label}`} className="mt-3 block text-center text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 border border-white/10 rounded-sm py-2 transition-colors">
              Investigate this company
            </a>
          )}
        </aside>
      )}
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider font-mono shrink-0">{label}</dt>
      <dd className={`text-xs text-right break-words ${highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</dd>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: 'critical' | 'warning' | 'info' }) {
  const cls = color === 'critical' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30'
    : color === 'warning' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30'
    : 'bg-white/5 text-ink-400 border-white/10';
  return <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${cls}`}>{children}</span>;
}

function titleCase(s: string): string {
  if (!s) return '';
  return s.replace(/[-_]/g, ' ').split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
