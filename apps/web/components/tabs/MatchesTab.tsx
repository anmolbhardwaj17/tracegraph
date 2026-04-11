'use client';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../Avatar';
import { API } from './shared';

interface DatasetStats {
  sanctions: number;
  offshoreEntities: number;
  offshoreOfficers: number;
  offshoreIntermediaries: number;
}

interface Props {
  matches: any[];
  counts?: { companies: number; people: number; addresses: number };
}

export function MatchesTab({ matches, counts }: Props) {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'opensanctions' | 'icij'>('all');
  const [confFilter, setConfFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');

  useEffect(() => {
    fetch(`${API}/api/datasets/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  // Stats
  const matchStats = useMemo(() => {
    const total = matches.length;
    const sanctions = matches.filter((m) => m.source === 'opensanctions').length;
    const icij = matches.filter((m) => m.source !== 'opensanctions').length;
    const highConf = matches.filter((m) => m.confidence >= 75).length;
    const avgConf = total > 0 ? Math.round(matches.reduce((s: number, m: any) => s + m.confidence, 0) / total) : 0;
    return { total, sanctions, icij, highConf, avgConf };
  }, [matches]);

  // Filtered
  const filtered = useMemo(() => {
    let result = [...matches];
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((m) =>
        (m.reasons?.matchedName || m.matchedEntityId || '').toLowerCase().includes(q) ||
        (m.sourceEntityId || '').toLowerCase().includes(q),
      );
    }
    if (sourceFilter !== 'all') {
      if (sourceFilter === 'opensanctions') result = result.filter((m) => m.source === 'opensanctions');
      else result = result.filter((m) => m.source !== 'opensanctions');
    }
    if (confFilter !== 'all') {
      if (confFilter === 'high') result = result.filter((m) => m.confidence >= 75);
      else if (confFilter === 'medium') result = result.filter((m) => m.confidence >= 50 && m.confidence < 75);
      else result = result.filter((m) => m.confidence < 50);
    }
    return result.sort((a: any, b: any) => b.confidence - a.confidence);
  }, [matches, search, sourceFilter, confFilter]);

  const hasFilters = search || sourceFilter !== 'all' || confFilter !== 'all';

  if (matches.length === 0) {
    const screened = (counts?.companies || 0) + (counts?.people || 0);
    const sanctionsCount = stats?.sanctions ?? 0;
    const offshoreCount = (stats?.offshoreEntities ?? 0) + (stats?.offshoreOfficers ?? 0);

    return (
      <div className="space-y-8">
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Matches screening</div>
          <div className="border border-white/5 bg-ink-850 p-8">
            <h2 className="text-2xl font-medium text-ink-50 mb-2">No matches found.</h2>
            <p className="text-sm text-ink-300 leading-relaxed max-w-2xl">
              We screened <span className="text-ink-50 font-medium">{screened.toLocaleString()}</span> entities against{' '}
              <span className="text-ink-50 font-medium">{sanctionsCount.toLocaleString()}</span> OpenSanctions records and{' '}
              <span className="text-ink-50 font-medium">{offshoreCount.toLocaleString()}</span> ICIJ OffshoreLeaks records.
            </p>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border border-white/5">
              <Stat label="Entities screened" value={screened.toLocaleString()} />
              <Stat label="OpenSanctions" value={sanctionsCount.toLocaleString()} />
              <Stat label="ICIJ entities" value={(stats?.offshoreEntities ?? 0).toLocaleString()} />
              <Stat label="ICIJ officers" value={(stats?.offshoreOfficers ?? 0).toLocaleString()} />
            </div>
            <button
              onClick={() => setReasonsOpen(!reasonsOpen)}
              className="mt-4 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 transition-colors"
            >
              {reasonsOpen ? '−' : '+'} Why a match might still be missed
            </button>
            {reasonsOpen && (
              <ul className="mt-3 space-y-1.5 text-xs text-ink-300">
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>Name variant our fuzzy matcher couldn't catch</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>Screened against names only, not numbers or aliases</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>Non-Latin characters need additional normalization</span></li>
              </ul>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats strip */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
          / Cross-source matches · {matchStats.total} hit{matchStats.total === 1 ? '' : 's'}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/5 border border-white/5">
          <Stat label="Total matches" value={String(matchStats.total)} />
          <Stat label="OpenSanctions" value={String(matchStats.sanctions)} highlight={matchStats.sanctions > 0} />
          <Stat label="ICIJ OffshoreLeaks" value={String(matchStats.icij)} highlight={matchStats.icij > 0} />
          <Stat label="High confidence" value={String(matchStats.highConf)} highlight={matchStats.highConf > 0} />
          <Stat label="Avg confidence" value={`${matchStats.avgConf}%`} />
        </div>
      </section>

      {/* Filters */}
      <section>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search matched name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-1">source</span>
            {(['all', 'opensanctions', 'icij'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                  sourceFilter === s
                    ? 'bg-white/10 text-ink-50 border-white/30'
                    : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                }`}
              >
                {s === 'all' ? 'all' : s === 'opensanctions' ? 'sanctions' : 'icij'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-1">confidence</span>
            {(['all', 'high', 'medium', 'low'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setConfFilter(c)}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                  confFilter === c
                    ? 'bg-white/10 text-ink-50 border-white/30'
                    : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setSourceFilter('all'); setConfFilter('all'); }}
              className="text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
            >
              clear →
            </button>
          )}
        </div>
      </section>

      {/* Match list */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
          / Results ({filtered.length}{filtered.length !== matches.length ? ` of ${matches.length}` : ''})
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-white/10 text-ink-500 text-sm font-mono">
            no matches match the current filters
          </div>
        ) : (
          <div className="border border-white/5">
            {/* Header */}
            <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
              <div className="col-span-4">Matched name</div>
              <div className="col-span-2">Entity type</div>
              <div className="col-span-2">Source</div>
              <div className="col-span-2">Match reasons</div>
              <div className="col-span-2 text-right">Confidence</div>
            </div>
            {filtered.map((m: any) => (
              <div key={m.id} className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 items-center hover:bg-white/[0.02] transition-colors">
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <Avatar name={m.reasons?.matchedName || m.matchedEntityId} type={m.sourceEntityType} size={28} />
                  <div className="min-w-0">
                    <div className="text-sm text-ink-50 truncate">{m.reasons?.matchedName || m.matchedEntityId}</div>
                    <div className="text-[10px] font-mono text-ink-600 truncate">{m.entityLabel || m.sourceEntityId}</div>
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-ink-400">{m.sourceEntityType}</span>
                </div>
                <div className="col-span-2">
                  <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
                    m.source === 'opensanctions'
                      ? 'bg-signal-critical/10 text-signal-critical border-signal-critical/30'
                      : 'bg-signal-high/10 text-signal-high border-signal-high/30'
                  }`}>
                    {m.source === 'opensanctions' ? 'Sanctions' : 'ICIJ'}
                  </span>
                </div>
                <div className="col-span-2 flex flex-wrap gap-1">
                  {m.reasons?.exactName && <Chip>exact</Chip>}
                  {m.reasons?.phoneticMatch && <Chip>phonetic</Chip>}
                  {m.reasons?.jaroWinkler && <Chip>JW {m.reasons.jaroWinkler}</Chip>}
                  {m.reasons?.dobMatch && <Chip>DOB</Chip>}
                </div>
                <div className="col-span-2 text-right">
                  <span className={`text-xs font-mono font-medium tabular-nums ${
                    m.confidence >= 75 ? 'text-signal-critical' :
                    m.confidence >= 50 ? 'text-signal-medium' :
                    'text-ink-400'
                  }`}>{m.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded-sm bg-white/5 text-ink-400 font-mono text-[9px] border border-white/5">{children}</span>;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`bg-ink-850 p-5 ${highlight ? 'border-l-2 border-signal-critical' : ''}`}>
      <div className="text-2xl font-medium text-ink-50 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">{label}</div>
    </div>
  );
}
