'use client';
import { useMemo, useState } from 'react';
import { Insights } from '../Insights';
import { SeverityBar } from '../SeverityBar';
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
}

const SEV_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const ALL_SEVERITIES: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const ALL_CONFIDENCES: NonNullable<Finding['confidence']>[] = ['HIGH', 'MEDIUM', 'LOW'];

export function FindingsTab({ findings, entities, investigationId }: { findings: Finding[]; entities?: any; investigationId: string }) {
  // id → label resolver (entities may carry uuid ids that show up in affectedEntities)
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

  const [search, setSearch] = useState('');
  const [sevFilter, setSevFilter] = useState<Set<string>>(new Set());
  const [confFilter, setConfFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'severity' | 'type' | 'title'>('severity');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const counts = useMemo(() => {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of findings) c[f.severity]++;
    return c;
  }, [findings]);

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) set.add(f.type);
    return Array.from(set).sort();
  }, [findings]);

  // Top affected entities - leaderboard (resolved to labels, duplicates collapsed)
  const topEntities = useMemo(() => {
    const tally = new Map<string, { count: number; raws: Set<string> }>();
    for (const f of findings) {
      for (const raw of f.affectedEntities || []) {
        const label = labelOf(raw);
        const cur = tally.get(label) || { count: 0, raws: new Set<string>() };
        cur.count++;
        cur.raws.add(raw);
        tally.set(label, cur);
      }
    }
    return Array.from(tally.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([label, v]) => ({ label, count: v.count, raws: v.raws }));
  }, [findings, labelOf]);

  const filtered = useMemo(() => {
    let result = [...findings];
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
    if (confFilter.size > 0) result = result.filter((f) => f.confidence && confFilter.has(f.confidence));
    if (typeFilter !== 'all') result = result.filter((f) => f.type === typeFilter);
    if (entityFilter) result = result.filter((f) => (f.affectedEntities || []).some((e) => labelOf(e) === entityFilter));

    result.sort((a, b) => {
      if (sortBy === 'severity') return SEV_RANK[a.severity] - SEV_RANK[b.severity];
      if (sortBy === 'type') return a.type.localeCompare(b.type);
      return a.title.localeCompare(b.title);
    });
    return result;
  }, [findings, search, sevFilter, confFilter, typeFilter, entityFilter, sortBy, labelOf]);

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  const visible = showAll ? filtered : filtered.slice(0, 50);
  const hasFilters = search || sevFilter.size > 0 || confFilter.size > 0 || typeFilter !== 'all' || entityFilter;

  if (findings.length === 0) {
    return <EmptyState message="No risk signals detected." />;
  }

  return (
    <div className="space-y-6">
      {/* A. Severity strip - clickable */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
          / Severity distribution · {findings.length} total findings · click a band to filter
        </div>
        <SeverityBar
          counts={counts}
          active={sevFilter}
          onToggle={(s) => setSevFilter(toggle(sevFilter, s))}
        />
      </section>

      {/* B. AI insights */}
      <Insights investigationId={investigationId} topic="findings" />

      {/* C. Filter bar */}
      <section>
        <div className="space-y-3">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Search title, description, evidence…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 focus:outline-none focus:border-white/30 font-mono text-xs"
            >
              <option value="all">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 focus:outline-none focus:border-white/30 font-mono text-xs"
            >
              <option value="severity">Sort: severity</option>
              <option value="type">Sort: type</option>
              <option value="title">Sort: title</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2">severity</span>
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
            <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2 ml-4">confidence</span>
            {ALL_CONFIDENCES.map((c) => (
              <button
                key={c}
                onClick={() => setConfFilter(toggle(confFilter, c))}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                  confFilter.has(c)
                    ? 'bg-white/10 text-ink-50 border-white/30'
                    : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                }`}
              >
                {c}
              </button>
            ))}
            {entityFilter && (
              <span className="text-[10px] font-mono px-2 py-1 rounded-sm border border-white/30 bg-white/10 text-ink-50">
                entity: {entityFilter} <button onClick={() => setEntityFilter(null)} className="ml-1 text-ink-400 hover:text-ink-50">×</button>
              </span>
            )}
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setSevFilter(new Set()); setConfFilter(new Set()); setTypeFilter('all'); setEntityFilter(null); }}
                className="ml-auto text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
              >
                clear filters →
              </button>
            )}
          </div>
        </div>
      </section>

      {/* D. Leaderboard + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:items-start">
        {/* Affected entity leaderboard */}
        <aside className="lg:col-span-1 border border-white/5 bg-ink-850 p-5 space-y-4 h-fit">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">/ Most-flagged entities</div>
            <div className="text-[10px] font-mono text-ink-600">click to filter findings</div>
          </div>
          {topEntities.length === 0 ? (
            <div className="text-xs font-mono text-ink-500 py-4 border border-dashed border-white/5 px-3">
              no affected entities recorded
            </div>
          ) : (
            <div className="space-y-1">
              {topEntities.map(({ label, count }) => {
                const active = entityFilter === label;
                return (
                  <button
                    key={label}
                    onClick={() => setEntityFilter(active ? null : label)}
                    className={`w-full text-left px-3 py-2 rounded-sm border transition-colors flex items-center gap-2 ${
                      active
                        ? 'bg-ink-900 border-white/30'
                        : 'bg-ink-900/40 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <span className={`text-xs leading-snug truncate flex-1 ${active ? 'text-ink-50' : 'text-ink-300'}`}>
                      {label}
                    </span>
                    <span className="text-[9px] font-mono text-ink-600 tabular-nums shrink-0">
                      {count}×
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        {/* Table */}
        <section className="lg:col-span-3">
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">
            / Findings ({filtered.length}{filtered.length !== findings.length ? ` of ${findings.length}` : ''})
          </div>
          <div className="text-[10px] font-mono text-ink-600 mt-1">click any row to expand evidence</div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState message="No findings match the current filters." />
        ) : (
          <div className="border border-white/5">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
              <div className="col-span-2">Severity</div>
              <div className="col-span-3">Type</div>
              <div className="col-span-5">Title</div>
              <div className="col-span-1 text-right">Conf</div>
              <div className="col-span-1 text-right">Affected</div>
            </div>
            {visible.map((f, idx) => {
              const realIdx = findings.indexOf(f);
              const isOpen = expanded.has(realIdx);
              return (
                <div key={`${f.type}-${idx}`} className="border-b border-white/5 last:border-b-0">
                  <button
                    onClick={() => setExpanded(toggle(expanded, realIdx))}
                    className="w-full grid grid-cols-12 gap-4 px-4 py-3 items-center text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="col-span-1">
                      <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${sevColors[f.severity]}`}>
                        {f.severity}
                      </span>
                    </div>
                    <div className="col-span-3 text-[11px] font-mono text-ink-400 truncate">{f.type}</div>
                    <div className="col-span-6 text-sm text-ink-50 truncate">{f.title}</div>
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
                                <span className="text-ink-500">›</span>
                                <span>{e}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {f.affectedEntities?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Affected entities</div>
                          <div className="text-[10px] text-ink-400 font-mono">
                            {f.affectedEntities.slice(0, 8).join('  ·  ')}
                            {f.affectedEntities.length > 8 ? `  +${f.affectedEntities.length - 8} more` : ''}
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Recommendation</div>
                        <p className="text-xs text-ink-300">{f.recommendation}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!showAll && filtered.length > 50 && (
          <button
            onClick={() => setShowAll(true)}
            className="mt-4 w-full py-3 border border-white/10 text-xs font-mono uppercase tracking-wider text-ink-400 hover:bg-white/5 transition-colors"
          >
            show all {filtered.length} findings →
          </button>
        )}
      </section>
      </div>
    </div>
  );
}

const sevColors: Record<string, string> = {
  CRITICAL: 'bg-signal-critical/15 text-signal-critical border-signal-critical/40',
  HIGH: 'bg-signal-high/15 text-signal-high border-signal-high/40',
  MEDIUM: 'bg-signal-medium/15 text-signal-medium border-signal-medium/40',
  LOW: 'bg-white/5 text-ink-300 border-white/10',
};
