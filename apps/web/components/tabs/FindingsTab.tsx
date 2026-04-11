'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Shield, ShieldAlert, Users, Globe } from 'lucide-react';
import { Insights } from '../Insights';
import { EmptyState } from './shared';

interface Finding {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  evidence: string[];
  affectedEntities: string[];
  recommendation: string;
  businessImpact?: string;
  legalReference?: string;
  verificationSteps?: string[];
}

interface Props {
  findings: Finding[];
  entities?: any;
  relations?: Record<string, string>;
  targetNodeId?: string | null;
  targetCompanyName?: string | null;
  investigationId: string;
}

const SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const ALL_SEVERITIES: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

type SevCounts = { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };

function countSev(list: Finding[]): SevCounts {
  const c: SevCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of list) c[f.severity]++;
  return c;
}

function sevSummary(c: SevCounts): string {
  const parts: string[] = [];
  if (c.CRITICAL) parts.push(`${c.CRITICAL} critical`);
  if (c.HIGH) parts.push(`${c.HIGH} high`);
  if (c.MEDIUM) parts.push(`${c.MEDIUM} medium`);
  if (c.LOW) parts.push(`${c.LOW} low`);
  return parts.join(', ');
}

function maxSev(c: SevCounts): string {
  if (c.CRITICAL > 0) return 'critical';
  if (c.HIGH > 0) return 'high';
  if (c.MEDIUM > 0) return 'medium';
  return 'clean';
}

const BORDER_COLOR: Record<string, string> = {
  critical: 'border-l-signal-critical',
  high: 'border-l-signal-high',
  medium: 'border-l-signal-medium',
  clean: 'border-l-signal-clean',
};

export function FindingsTab({ findings, entities, relations, targetNodeId, targetCompanyName, investigationId }: Props) {
  const targetName = targetCompanyName || 'Target company';

  // Build ID-to-label map
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    if (entities) {
      for (const group of ['company', 'person', 'address'] as const) {
        for (const e of entities[group] || []) {
          if (e.id) m.set(e.id, e.label);
          if (e.entityId) m.set(e.entityId, e.label);
        }
      }
    }
    return (raw: string) => m.get(raw) || raw;
  }, [entities]);

  // Map from any entity identifier (uuid or entityId) to its node uuid
  const idToUuid = useMemo(() => {
    const m = new Map<string, string>();
    if (entities) {
      for (const group of ['company', 'person', 'address'] as const) {
        for (const e of entities[group] || []) {
          if (e.id) m.set(e.id, e.id);
          if (e.entityId && e.id) m.set(e.entityId, e.id);
        }
      }
    }
    return m;
  }, [entities]);

  // Build ID-to-relation map (resolves both uuid and entityId)
  const relOf = useMemo(() => {
    if (!relations) return (_id: string) => 'Network';
    return (id: string) => {
      // Direct lookup
      if (relations[id]) return relations[id];
      // Try resolving entityId to uuid first
      const uuid = idToUuid.get(id);
      if (uuid && relations[uuid]) return relations[uuid];
      return 'Network';
    };
  }, [relations, idToUuid]);

  // Build sets that include BOTH uuid and entityId for target and directors
  const { targetIds, directorIds } = useMemo(() => {
    const tIds = new Set<string>();
    const dIds = new Set<string>();
    if (relations) {
      for (const [id, rel] of Object.entries(relations)) {
        if (rel === 'Target') tIds.add(id);
        if (rel === 'Director' || rel === 'PSC/Owner') dIds.add(id);
      }
    }
    if (targetNodeId) tIds.add(targetNodeId);
    // Also add entityId aliases so affectedEntities (which may use company numbers) match
    if (entities) {
      for (const group of ['company', 'person', 'address'] as const) {
        for (const e of entities[group] || []) {
          if (tIds.has(e.id) && e.entityId) tIds.add(e.entityId);
          if (dIds.has(e.id) && e.entityId) dIds.add(e.entityId);
        }
      }
    }
    return { targetIds: tIds, directorIds: dIds };
  }, [relations, targetNodeId, entities]);

  // Classify each finding into a section
  const { targetFindings, directorFindings, networkFindings } = useMemo(() => {
    const target: Finding[] = [];
    const director: Finding[] = [];
    const network: Finding[] = [];

    for (const f of findings) {
      const affected = f.affectedEntities || [];
      const hitsTarget = affected.some((id) => targetIds.has(id));
      const hitsDirector = affected.some((id) => directorIds.has(id));

      if (hitsTarget) target.push(f);
      else if (hitsDirector) director.push(f);
      else network.push(f);
    }

    // Sort each by severity
    const sorter = (a: Finding, b: Finding) => SEV_RANK[a.severity] - SEV_RANK[b.severity];
    target.sort(sorter);
    director.sort(sorter);
    network.sort(sorter);

    return { targetFindings: target, directorFindings: director, networkFindings: network };
  }, [findings, targetIds, directorIds]);

  // Filter state
  const [search, setSearch] = useState('');
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) set.add(f.type);
    return Array.from(set).sort();
  }, [findings]);

  // Apply filters to a list of findings
  function applyFilters(list: Finding[]): Finding[] {
    let result = list;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((f) =>
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.type.toLowerCase().includes(q) ||
        f.evidence?.some((e) => e.toLowerCase().includes(q)),
      );
    }
    if (sevFilter.size > 0) result = result.filter((f) => sevFilter.has(f.severity));
    if (typeFilter !== 'all') result = result.filter((f) => f.type === typeFilter);
    if (entityFilter) result = result.filter((f) => (f.affectedEntities || []).some((e) => labelOf(e) === entityFilter));
    return result;
  }

  const filteredTarget = applyFilters(targetFindings);
  const filteredDirector = applyFilters(directorFindings);
  const filteredNetwork = applyFilters(networkFindings);

  const hasFilters = !!(search || sevFilter.size > 0 || typeFilter !== 'all' || entityFilter);

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function toggleExpand(key: string) {
    setExpanded(toggle(expanded, key));
  }

  // Leaderboard split into Direct and Network
  const { directEntities, networkEntities } = useMemo(() => {
    const directTally = new Map<string, { count: number; relation: string }>();
    const networkTally = new Map<string, { count: number; relation: string }>();

    for (const f of findings) {
      for (const raw of f.affectedEntities || []) {
        const label = labelOf(raw);
        const rel = relOf(raw);
        const isDirect = targetIds.has(raw) || directorIds.has(raw);
        const tally = isDirect ? directTally : networkTally;
        const cur = tally.get(label) || { count: 0, relation: rel };
        cur.count++;
        tally.set(label, cur);
      }
    }

    const toList = (m: Map<string, { count: number; relation: string }>) =>
      Array.from(m.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 8)
        .map(([label, v]) => ({ label, count: v.count, relation: v.relation }));

    return { directEntities: toList(directTally), networkEntities: toList(networkTally) };
  }, [findings, labelOf, relOf, targetIds, directorIds]);

  // Severity counts per section
  const targetCounts = countSev(targetFindings);
  const directorCounts = countSev(directorFindings);
  const networkCounts = countSev(networkFindings);

  if (findings.length === 0) {
    return <EmptyState message="No risk signals detected." />;
  }

  // Severity counts for the stat strip
  const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
  const highCount = findings.filter((f) => f.severity === 'HIGH').length;

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/5 border border-white/5">
        <StatBox label="Total" value={findings.length.toLocaleString()} />
        <StatBox label={targetName} value={String(targetFindings.length)} highlight={targetFindings.some((f) => f.severity === 'CRITICAL')} />
        <StatBox label="Directors" value={String(directorFindings.length)} highlight={directorFindings.some((f) => f.severity === 'CRITICAL')} />
        <StatBox label="Critical" value={String(criticalCount)} highlight={criticalCount > 0} />
        <StatBox label="High" value={String(highCount)} />
      </div>

      {/* AI insights - now target-focused */}
      <Insights investigationId={investigationId} topic="findings" />

      {/* Filter bar */}
      <section>
        <div className="flex gap-3 flex-wrap items-center">
          <input
            type="text"
            placeholder="Search findings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-ink-50 focus:outline-none focus:border-white/30 font-mono text-[11px]"
          >
            <option value="all">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            {ALL_SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => setSevFilter(toggle(sevFilter, s))}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                  sevFilter.has(s)
                    ? sevColors[s] + ' border-current'
                    : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {entityFilter && (
            <span className="text-[10px] font-mono px-2 py-1 rounded-sm border border-white/30 bg-white/10 text-ink-50">
              {entityFilter} <button onClick={() => setEntityFilter(null)} className="ml-1 text-ink-400 hover:text-ink-50">x</button>
            </span>
          )}
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setSevFilter(new Set()); setTypeFilter('all'); setEntityFilter(null); }}
              className="text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
            >
              clear filters
            </button>
          )}
        </div>
      </section>

      {/* Main content: Leaderboard + Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:items-start">
        {/* Leaderboard sidebar */}
        <aside className="lg:col-span-1 space-y-4 h-fit">
          <LeaderboardSection
            title="Direct"
            subtitle="Target + directors"
            items={directEntities}
            activeFilter={entityFilter}
            onFilter={setEntityFilter}
          />
          <LeaderboardSection
            title="Network"
            subtitle="Wider connections"
            items={networkEntities}
            activeFilter={entityFilter}
            onFilter={setEntityFilter}
          />
        </aside>

        {/* Finding sections */}
        <div className="lg:col-span-3 space-y-6">
          {/* SECTION A: About the target */}
          <FindingSection
            icon={<Shield size={14} />}
            title={`About ${targetName}`}
            subtitle={filteredTarget.length > 0
              ? `${filteredTarget.length} finding${filteredTarget.length > 1 ? 's' : ''} - ${sevSummary(countSev(filteredTarget))}`
              : undefined
            }
            borderColor={BORDER_COLOR[maxSev(targetCounts)]}
            findings={filteredTarget}
            expanded={expanded}
            onToggle={toggleExpand}
            labelOf={labelOf}
            relOf={relOf}
            defaultOpen
            emptyMessage={`No risk signals detected directly on ${targetName}.`}
            emptyIsGood
          />

          {/* SECTION B: About the directors */}
          <FindingSection
            icon={<Users size={14} />}
            title="About the directors"
            subtitle={filteredDirector.length > 0
              ? `${filteredDirector.length} finding${filteredDirector.length > 1 ? 's' : ''} - ${sevSummary(countSev(filteredDirector))}`
              : undefined
            }
            borderColor={BORDER_COLOR[maxSev(directorCounts)]}
            findings={filteredDirector}
            expanded={expanded}
            onToggle={toggleExpand}
            labelOf={labelOf}
            relOf={relOf}
            defaultOpen
            emptyMessage="No risk signals on target company directors."
            emptyIsGood
            showRelation
          />

          {/* SECTION C: Wider network */}
          <div className={`border border-white/5 border-l-2 ${BORDER_COLOR[maxSev(networkCounts)]}`}>
            <button
              onClick={() => setNetworkOpen(!networkOpen)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Globe size={14} className="text-ink-500" />
                <div className="text-left">
                  <div className="text-sm text-ink-50 font-medium">Wider network</div>
                  {filteredNetwork.length > 0 ? (
                    <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                      {filteredNetwork.length} additional finding{filteredNetwork.length > 1 ? 's' : ''} - {sevSummary(countSev(filteredNetwork))}
                    </div>
                  ) : (
                    <div className="text-[10px] font-mono text-ink-500 mt-0.5">No network findings</div>
                  )}
                </div>
              </div>
              {networkOpen ? <ChevronDown size={14} className="text-ink-500" /> : <ChevronRight size={14} className="text-ink-500" />}
            </button>
            {networkOpen && filteredNetwork.length > 0 && (
              <div className="border-t border-white/5">
                <FindingsTable
                  findings={filteredNetwork}
                  expanded={expanded}
                  onToggle={toggleExpand}
                  labelOf={labelOf}
                  relOf={relOf}
                  keyPrefix="network"
                  showRelation
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function LeaderboardSection({ title, subtitle, items, activeFilter, onFilter }: {
  title: string; subtitle: string;
  items: Array<{ label: string; count: number; relation: string }>;
  activeFilter: string | null; onFilter: (label: string | null) => void;
}) {
  return (
    <div className="border border-white/5 bg-ink-850 p-4 space-y-3">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ {title}</div>
        <div className="text-[10px] font-mono text-ink-600">{subtitle}</div>
      </div>
      {items.length === 0 ? (
        <div className="text-[10px] font-mono text-ink-600 py-2">no entities</div>
      ) : (
        <div className="space-y-0.5">
          {items.map(({ label, count, relation }) => {
            const active = activeFilter === label;
            return (
              <button
                key={label}
                onClick={() => onFilter(active ? null : label)}
                className={`w-full text-left px-3 py-1.5 rounded-sm border transition-colors flex items-center gap-2 ${
                  active ? 'bg-ink-900 border-white/30' : 'bg-ink-900/40 border-white/5 hover:border-white/15'
                }`}
              >
                <span className={`text-[11px] leading-snug truncate flex-1 ${active ? 'text-ink-50' : 'text-ink-300'}`}>
                  {label}
                </span>
                <span className="text-[9px] font-mono text-ink-600 shrink-0">{relation}</span>
                <span className="text-[9px] font-mono text-ink-600 tabular-nums shrink-0">{count}x</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FindingSection({ icon, title, subtitle, borderColor, findings, expanded, onToggle, labelOf, relOf, defaultOpen, emptyMessage, emptyIsGood, showRelation }: {
  icon: React.ReactNode; title: string; subtitle?: string; borderColor: string;
  findings: Finding[]; expanded: Set<string>; onToggle: (key: string) => void;
  labelOf: (id: string) => string; relOf: (id: string) => string;
  defaultOpen?: boolean; emptyMessage: string; emptyIsGood?: boolean; showRelation?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const keyPrefix = title.replace(/\s/g, '-').toLowerCase();

  return (
    <div className={`border border-white/5 border-l-2 ${borderColor}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-ink-500">{icon}</span>
          <div className="text-left">
            <div className="text-sm text-ink-50 font-medium">{title}</div>
            {subtitle && <div className="text-[10px] font-mono text-ink-500 mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {open ? <ChevronDown size={14} className="text-ink-500" /> : <ChevronRight size={14} className="text-ink-500" />}
      </button>
      {open && (
        <div className="border-t border-white/5">
          {findings.length === 0 ? (
            emptyIsGood ? (
              <div className="px-5 py-6 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-signal-clean" />
                <span className="text-sm text-ink-300">{emptyMessage}</span>
              </div>
            ) : (
              <div className="px-5 py-6 text-sm text-ink-500 font-mono">{emptyMessage}</div>
            )
          ) : (
            <FindingsTable
              findings={findings}
              expanded={expanded}
              onToggle={onToggle}
              labelOf={labelOf}
              relOf={relOf}
              keyPrefix={keyPrefix}
              showRelation={showRelation}
            />
          )}
        </div>
      )}
    </div>
  );
}

function FindingsTable({ findings, expanded, onToggle, labelOf, relOf, keyPrefix, showRelation }: {
  findings: Finding[]; expanded: Set<string>; onToggle: (key: string) => void;
  labelOf: (id: string) => string; relOf: (id: string) => string;
  keyPrefix: string; showRelation?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? findings : findings.slice(0, 30);

  return (
    <div>
      {/* Header */}
      <div className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
        <div className="col-span-1">Sev</div>
        <div className="col-span-3">Type</div>
        <div className="col-span-6">Title</div>
        <div className="col-span-1 text-right">Conf</div>
        <div className="col-span-1 text-right">Ent</div>
      </div>
      {visible.map((f, idx) => {
        const key = `${keyPrefix}-${idx}`;
        const isOpen = expanded.has(key);
        // Resolve primary affected entity for relation display
        const primaryEntity = showRelation && f.affectedEntities?.[0] ? f.affectedEntities[0] : null;
        const primaryLabel = primaryEntity ? labelOf(primaryEntity) : null;
        const primaryRel = primaryEntity ? relOf(primaryEntity) : null;

        return (
          <div key={key} className="border-b border-white/5 last:border-b-0">
            <button
              onClick={() => onToggle(key)}
              className="w-full grid grid-cols-12 gap-3 px-4 py-3 items-center text-left hover:bg-white/[0.02] transition-colors"
            >
              <div className="col-span-1">
                <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${sevColors[f.severity]}`}>
                  {f.severity.slice(0, 4)}
                </span>
              </div>
              <div className="col-span-3 text-[11px] font-mono text-ink-400 truncate">{f.type}</div>
              <div className="col-span-6 min-w-0">
                <div className="text-sm text-ink-50 truncate">{f.title}</div>
                {showRelation && primaryLabel && primaryRel && (
                  <div className="text-[10px] font-mono text-ink-600 mt-0.5 truncate">
                    {primaryRel} - {primaryLabel}
                  </div>
                )}
              </div>
              <div className="col-span-1 text-right">
                {f.confidence && (
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    f.confidence === 'HIGH' ? 'bg-signal-clean' : f.confidence === 'MEDIUM' ? 'bg-signal-medium' : 'bg-ink-500'
                  }`} title={f.confidence} />
                )}
              </div>
              <div className="col-span-1 text-right text-xs font-mono text-ink-400">
                {f.affectedEntities?.length || 0}
              </div>
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1 text-sm space-y-3 bg-white/[0.01] border-t border-white/5">
                <p className="text-ink-300 leading-relaxed pt-3">{f.description}</p>
                {f.evidence?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Evidence</div>
                    <ul className="space-y-1">
                      {f.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-ink-300 flex gap-2">
                          <span className="text-ink-500">{'>'}</span>
                          <span>{e}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {f.affectedEntities?.length > 0 && (
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Affected entities</div>
                    <div className="flex flex-wrap gap-1.5">
                      {f.affectedEntities.slice(0, 8).map((e, i) => (
                        <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-ink-900 border border-white/5 text-ink-300">
                          {labelOf(e)}
                        </span>
                      ))}
                      {f.affectedEntities.length > 8 && (
                        <span className="text-[10px] font-mono text-ink-600 px-2 py-0.5">+{f.affectedEntities.length - 8} more</span>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Recommendation</div>
                  <p className="text-xs text-ink-300">{f.recommendation}</p>
                </div>
                {f.businessImpact && (
                  <div className="border-t border-white/5 pt-3 mt-3">
                    <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Business impact</div>
                    <p className="text-xs text-ink-300 leading-relaxed">{f.businessImpact}</p>
                    {f.legalReference && (
                      <div className="text-[10px] font-mono text-ink-500 mt-2">Legal: {f.legalReference}</div>
                    )}
                    {f.verificationSteps && f.verificationSteps.length > 0 && (
                      <div className="mt-2">
                        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-1">/ Verification steps</div>
                        <ul className="space-y-1">
                          {f.verificationSteps.map((s, si) => (
                            <li key={si} className="text-xs text-ink-300 flex gap-2">
                              <span className="text-ink-500">{si + 1}.</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!showAll && findings.length > 30 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-3 border-t border-white/5 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:bg-white/[0.02] transition-colors"
        >
          show all {findings.length} findings
        </button>
      )}
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-ink-850 px-4 py-3 ${highlight ? 'border-l-2 border-signal-critical' : ''}`}>
      <div className={`text-2xl font-medium tabular-nums ${highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono truncate">{label}</div>
    </div>
  );
}

const sevColors: Record<string, string> = {
  CRITICAL: 'bg-signal-critical/15 text-signal-critical border-signal-critical/40',
  HIGH: 'bg-signal-high/15 text-signal-high border-signal-high/40',
  MEDIUM: 'bg-signal-medium/15 text-signal-medium border-signal-medium/40',
  LOW: 'bg-white/5 text-ink-300 border-white/10',
};
