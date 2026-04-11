'use client';
import { useMemo, useState } from 'react';
import { EmptyState } from './shared';

interface ChainNode {
  level: number;
  kind: 'company' | 'person' | 'unknown';
  name: string;
  companyNumber?: string;
  jurisdiction?: string;
  ownershipPct?: number;
  naturesOfControl?: string[];
}

interface UboChain {
  id: string;
  rootCompanyNumber: string;
  rootCompanyName: string;
  path: ChainNode[];
  effectiveOwnershipPct: number;
  flags: ('DEEP' | 'OFFSHORE' | 'DEAD_END' | 'CIRCULAR')[];
  terminationReason: string;
}

interface Props {
  chains: UboChain[];
  findings?: any[];
  entities?: any;
  targetCompanyName?: string;
}

const FLAG_COLOR: Record<string, string> = {
  DEEP: 'bg-signal-medium/15 text-signal-medium border-signal-medium/30',
  OFFSHORE: 'bg-signal-critical/15 text-signal-critical border-signal-critical/30',
  DEAD_END: 'bg-white/5 text-ink-400 border-white/10',
  CIRCULAR: 'bg-signal-high/15 text-signal-high border-signal-high/30',
};

export function UBOTab({ chains, findings = [], entities, targetCompanyName }: Props) {
  const [showFormer, setShowFormer] = useState(false);
  const [selectedNode, setSelectedNode] = useState<ChainNode | null>(null);

  // Compute ownership summary
  const summary = useMemo(() => {
    if (chains.length === 0) return null;

    const resolvedChains = chains.filter((c) => c.path[0]?.kind === 'person');
    const offshoreChains = chains.filter((c) => c.flags.includes('OFFSHORE'));
    const deadEndChains = chains.filter((c) => c.flags.includes('DEAD_END'));
    const maxLayers = Math.max(...chains.map((c) => c.path.length));
    const topOwner = resolvedChains.sort((a, b) => b.effectiveOwnershipPct - a.effectiveOwnershipPct)[0];
    const totalResolved = resolvedChains.reduce((s, c) => s + c.effectiveOwnershipPct, 0);

    // Unique UBOs (persons at top of chains)
    const ubos = new Map<string, { name: string; pct: number; jurisdiction?: string }>();
    for (const c of resolvedChains) {
      const person = c.path[0];
      if (person?.kind === 'person') {
        const existing = ubos.get(person.name);
        if (!existing || c.effectiveOwnershipPct > existing.pct) {
          ubos.set(person.name, { name: person.name, pct: c.effectiveOwnershipPct, jurisdiction: person.jurisdiction });
        }
      }
    }

    let verdict: 'TRANSPARENT' | 'COMPLEX' | 'OPAQUE';
    let verdictColor: string;
    let text: string;

    if (resolvedChains.length === chains.length && offshoreChains.length === 0 && maxLayers <= 3) {
      verdict = 'TRANSPARENT';
      verdictColor = 'bg-signal-clean/15 text-signal-clean border-signal-clean/30';
      if (ubos.size === 1) {
        const [ubo] = [...ubos.values()];
        text = `${targetCompanyName || 'This company'} is ultimately controlled by ${ubo.name}${ubo.jurisdiction ? ` (${ubo.jurisdiction})` : ''} who holds ${ubo.pct}% effective ownership. Structure is straightforward - ${maxLayers} layer${maxLayers > 1 ? 's' : ''}, no offshore jurisdictions.`;
      } else {
        text = `${targetCompanyName || 'This company'} has ${ubos.size} identified beneficial owners. All ownership chains resolved to natural persons. ${maxLayers} layer${maxLayers > 1 ? 's' : ''}, no offshore jurisdictions.`;
      }
    } else if (deadEndChains.length > 0 || offshoreChains.length > chains.length / 2) {
      verdict = 'OPAQUE';
      verdictColor = 'bg-signal-critical/15 text-signal-critical border-signal-critical/30';
      text = `${targetCompanyName || 'This company'}'s ultimate ownership could not be fully resolved. ${deadEndChains.length} chain${deadEndChains.length > 1 ? 's' : ''} hit dead ends.${offshoreChains.length > 0 ? ` ${offshoreChains.length} chain${offshoreChains.length > 1 ? 's pass' : ' passes'} through offshore jurisdictions.` : ''} Effective ownership attributable to identified persons: ${Math.round(totalResolved)}%.`;
    } else {
      verdict = 'COMPLEX';
      verdictColor = 'bg-signal-medium/15 text-signal-medium border-signal-medium/30';
      text = `${targetCompanyName || 'This company'} has ${chains.length} ownership chain${chains.length > 1 ? 's' : ''}. ${resolvedChains.length} resolved to natural persons.${offshoreChains.length > 0 ? ` ${offshoreChains.length} pass through offshore jurisdictions.` : ''} Maximum depth: ${maxLayers} layers.`;
    }

    return { verdict, verdictColor, text, ubos: [...ubos.values()].sort((a, b) => b.pct - a.pct).slice(0, 3), maxLayers, totalResolved };
  }, [chains, targetCompanyName]);

  // Cross-reference UBOs with findings
  const uboFindings = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!entities) return map;
    const allPersons = entities.person || [];
    for (const chain of chains) {
      const person = chain.path[0];
      if (person?.kind !== 'person') continue;
      const personNode = allPersons.find((p: any) => p.label?.toLowerCase() === person.name.toLowerCase());
      if (!personNode) continue;
      const relatedFindings = findings.filter((f) =>
        (f.affectedEntities || []).some((eid: string) => eid === personNode.entityId || eid === personNode.id),
      );
      if (relatedFindings.length > 0 || personNode.metadata?.directorProfile || personNode.metadata?.disqualifications) {
        map.set(person.name, [{
          findings: relatedFindings,
          directorProfile: personNode.metadata?.directorProfile,
          disqualifications: personNode.metadata?.disqualifications,
          directorVelocity: personNode.metadata?.directorVelocity,
          matches: personNode.matches,
        }]);
      }
    }
    return map;
  }, [chains, findings, entities]);

  // Build unified tree nodes for SVG
  const treeData = useMemo(() => {
    if (chains.length === 0) return null;
    // Merge all chains into one tree structure
    const nodeMap = new Map<string, { node: ChainNode; children: string[]; parent?: string }>();
    const rootKey = chains[0]?.rootCompanyName || 'Target';

    for (const chain of chains) {
      for (let i = chain.path.length - 1; i >= 0; i--) {
        const n = chain.path[i];
        const key = n.companyNumber || n.name;
        if (!nodeMap.has(key)) {
          nodeMap.set(key, { node: n, children: [] });
        }
        if (i > 0) {
          const parentKey = chain.path[i - 1].companyNumber || chain.path[i - 1].name;
          const existing = nodeMap.get(key)!;
          if (!existing.children.includes(parentKey)) existing.children.push(parentKey);
        }
      }
    }
    return { nodeMap, rootKey };
  }, [chains]);

  // Control type breakdown
  const controlTypes = useMemo(() => {
    const types: Record<string, string[]> = { shares: [], voting: [], appointment: [], influence: [] };
    for (const chain of chains) {
      for (const node of chain.path) {
        if (!node.naturesOfControl) continue;
        for (const nc of node.naturesOfControl) {
          const ncl = nc.toLowerCase();
          if (ncl.includes('ownership-of-shares') || ncl.includes('right-to-share')) {
            types.shares.push(`${node.name}: ${node.ownershipPct || '?'}%`);
          } else if (ncl.includes('voting-rights')) {
            types.voting.push(`${node.name}: ${node.ownershipPct || '?'}%`);
          } else if (ncl.includes('right-to-appoint')) {
            types.appointment.push(node.name);
          } else if (ncl.includes('significant-influence')) {
            types.influence.push(node.name);
          }
        }
      }
    }
    return types;
  }, [chains]);

  if (chains.length === 0) {
    return <EmptyState message="No PSC chains were resolved. The root company may have no PSCs filed, or the investigation tier did not include UBO resolution." />;
  }

  return (
    <div className="space-y-6">
      {/* CHANGE 1: Ownership summary */}
      {summary && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">/ Who controls {targetCompanyName || 'this company'}?</div>
              <p className="text-sm text-ink-300 leading-relaxed">{summary.text}</p>
            </div>
            <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border shrink-0 ${summary.verdictColor}`}>
              {summary.verdict}
            </span>
          </div>

          {/* Top UBOs */}
          {summary.ubos.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/5">
              {summary.ubos.map((ubo, i) => {
                const risk = uboFindings.get(ubo.name);
                return (
                  <div key={i} className="border border-white/5 bg-ink-900 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-full bg-signal-clean/10 text-signal-clean flex items-center justify-center text-xs font-bold shrink-0">
                        {ubo.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-ink-50 font-medium truncate">{ubo.name}</div>
                        {ubo.jurisdiction && <div className="text-[10px] text-ink-500 font-mono">{ubo.jurisdiction}</div>}
                      </div>
                    </div>
                    <div className="text-2xl font-medium text-ink-50 tabular-nums">{ubo.pct}%</div>
                    <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider">effective ownership</div>

                    {/* Cross-reference risk */}
                    {risk && risk[0] && (
                      <div className="mt-3 pt-3 border-t border-white/5 space-y-1">
                        {risk[0].disqualifications?.length > 0 && (
                          <div className="text-[10px] text-signal-critical font-mono">Disqualified director match</div>
                        )}
                        {risk[0].directorProfile?.totalAppointments > 0 && (
                          <div className="text-[10px] text-ink-400 font-mono">
                            {risk[0].directorProfile.totalAppointments} total appointments
                            {risk[0].directorProfile.dissolved > 0 && ` - ${risk[0].directorProfile.dissolved} dissolved`}
                          </div>
                        )}
                        {risk[0].findings?.length > 0 && (
                          <div className="text-[10px] text-signal-medium font-mono">{risk[0].findings.length} finding{risk[0].findings.length > 1 ? 's' : ''}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* CHANGE 6: Comparison line */}
      <div className="text-xs text-ink-500 font-mono px-1">
        Typical UK private companies have 1-2 ownership layers. This company has {summary?.maxLayers || 0} layer{(summary?.maxLayers || 0) !== 1 ? 's' : ''}.
      </div>

      {/* CHANGE 2: Visual ownership tree */}
      <div className="border border-white/5 bg-ink-850 p-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-6">/ Ownership structure</div>
        <div className="space-y-1">
          {chains.map((chain) => (
            <div key={chain.id} className="mb-6 last:mb-0">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-mono text-ink-500">{chain.effectiveOwnershipPct}% effective</span>
                {chain.flags.map((f) => (
                  <span key={f} className={`text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded-sm border ${FLAG_COLOR[f]}`}>{f}</span>
                ))}
              </div>
              {/* Tree: UBO at top, target at bottom */}
              <div className="relative pl-6">
                {chain.path.map((node, i) => {
                  const isFirst = i === 0;
                  const isLast = i === chain.path.length - 1;
                  const isPerson = node.kind === 'person';
                  const isOffshore = node.jurisdiction && /british virgin|cayman|panama|seychelles|marshall|belize|jersey|guernsey|isle of man/i.test(node.jurisdiction);
                  const hasRisk = uboFindings.has(node.name);

                  return (
                    <div key={i} className="relative pb-1">
                      {/* Vertical line */}
                      {!isLast && <div className="absolute left-[7px] top-[18px] bottom-0 w-px bg-white/10" />}

                      <button onClick={() => setSelectedNode(node)} className="flex items-start gap-3 w-full text-left hover:bg-white/[0.02] py-1.5 -ml-1 pl-1 rounded-sm transition-colors">
                        {/* Node dot */}
                        <div className={`w-4 h-4 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[8px] font-bold ${
                          isPerson ? 'bg-signal-clean/20 border border-signal-clean/50 text-signal-clean' :
                          isOffshore ? 'bg-signal-critical/20 border border-signal-critical/50 text-signal-critical' :
                          isLast ? 'bg-white/20 border border-white/50 text-white' :
                          'bg-[#60A5FA]/20 border border-[#60A5FA]/50 text-[#60A5FA]'
                        } ${hasRisk ? 'ring-1 ring-signal-critical/50' : ''}`}>
                          {isPerson ? '●' : isLast ? '★' : ''}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm ${isFirst || isLast ? 'text-ink-50 font-medium' : 'text-ink-300'}`}>{node.name}</span>
                            {isFirst && <span className="text-[8px] font-mono text-signal-clean bg-signal-clean/10 px-1 py-0.5 rounded-sm">UBO</span>}
                            {isLast && <span className="text-[8px] font-mono text-white bg-white/10 px-1 py-0.5 rounded-sm">TARGET</span>}
                            {isOffshore && <span className="text-[8px] font-mono text-signal-critical">OFFSHORE</span>}
                          </div>
                          <div className="text-[10px] font-mono text-ink-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            {node.companyNumber && <span>#{node.companyNumber}</span>}
                            {node.jurisdiction && <span>{node.jurisdiction}</span>}
                            {node.ownershipPct != null && !isLast && <span className="text-ink-400">holds {node.ownershipPct}% ↓</span>}
                          </div>
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CHANGE 3: Control type breakdown */}
      {(controlTypes.shares.length > 0 || controlTypes.voting.length > 0 || controlTypes.appointment.length > 0) && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Control mechanisms</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <ControlCard label="Share ownership" items={controlTypes.shares} />
            <ControlCard label="Voting rights" items={controlTypes.voting} />
            <ControlCard label="Appointment rights" items={controlTypes.appointment} />
            <ControlCard label="Significant influence" items={controlTypes.influence} />
          </div>
        </div>
      )}

      {/* Selected node detail */}
      {selectedNode && (
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{selectedNode.kind}</div>
              <div className="text-base font-medium text-ink-50 mt-1">{selectedNode.name}</div>
            </div>
            <button onClick={() => setSelectedNode(null)} className="text-ink-500 hover:text-ink-50 text-lg">x</button>
          </div>
          <dl className="space-y-2 text-sm">
            {selectedNode.companyNumber && <Field label="Company #" value={selectedNode.companyNumber} />}
            {selectedNode.jurisdiction && <Field label="Jurisdiction" value={selectedNode.jurisdiction} />}
            {selectedNode.ownershipPct != null && <Field label="Ownership" value={`${selectedNode.ownershipPct}%`} />}
            {selectedNode.naturesOfControl?.map((nc, i) => (
              <Field key={i} label="Control" value={nc.replace(/-/g, ' ')} />
            ))}
          </dl>
        </div>
      )}

      {/* CHANGE 5: Former ownership (collapsed) */}
      <button onClick={() => setShowFormer(!showFormer)} className="text-[10px] font-mono text-ink-500 hover:text-ink-50 transition-colors">
        {showFormer ? '- Hide' : '+ Show'} previous ownership
      </button>
      {showFormer && (
        <div className="border border-white/5 bg-ink-850 p-5 text-xs text-ink-500">
          Previous ownership data requires historical PSC filings which are not currently tracked. Future versions will show ownership transitions over time.
        </div>
      )}
    </div>
  );
}

function ControlCard({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="bg-ink-900 p-3 border border-white/5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-2">{label}</div>
      {items.length === 0 ? (
        <div className="text-[10px] text-ink-600">None identified</div>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 3).map((item, i) => (
            <li key={i} className="text-[10px] text-ink-300 truncate">{item}</li>
          ))}
          {items.length > 3 && <li className="text-[10px] text-ink-600">+{items.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider font-mono">{label}</dt>
      <dd className="text-xs text-ink-50 text-right">{value}</dd>
    </div>
  );
}
