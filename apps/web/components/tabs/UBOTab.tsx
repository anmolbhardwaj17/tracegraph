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
  /** UBO at index 0, root company at the last index. */
  path: ChainNode[];
  effectiveOwnershipPct: number;
  flags: ('DEEP' | 'OFFSHORE' | 'DEAD_END' | 'CIRCULAR')[];
  terminationReason: string;
}

const FLAG_COLOR: Record<string, string> = {
  DEEP: 'bg-signal-medium/15 text-signal-medium border-signal-medium/30',
  OFFSHORE: 'bg-signal-critical/15 text-signal-critical border-signal-critical/30',
  DEAD_END: 'bg-white/5 text-ink-400 border-white/10',
  CIRCULAR: 'bg-signal-high/15 text-signal-high border-signal-high/30',
};

export function UBOTab({ chains }: { chains: UboChain[] }) {
  const [activeFlags, setActiveFlags] = useState<Set<string>>(new Set());

  const stats = useMemo(() => {
    const total = chains.length;
    const persons = chains.filter((c) => c.path[0]?.kind === 'person').length;
    const offshore = chains.filter((c) => c.flags.includes('OFFSHORE')).length;
    const deep = chains.filter((c) => c.flags.includes('DEEP')).length;
    const deadEnd = chains.filter((c) => c.flags.includes('DEAD_END')).length;
    const maxOwnership = chains.reduce((m, c) => Math.max(m, c.effectiveOwnershipPct), 0);
    return { total, persons, offshore, deep, deadEnd, maxOwnership };
  }, [chains]);

  const filtered = useMemo(() => {
    if (activeFlags.size === 0) return chains;
    return chains.filter((c) => c.flags.some((f) => activeFlags.has(f)));
  }, [chains, activeFlags]);

  function toggleFlag(f: string) {
    const next = new Set(activeFlags);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setActiveFlags(next);
  }

  if (chains.length === 0) {
    return (
      <EmptyState message="No PSC chains were resolved. The root company may have no PSCs filed, or the build was skipped on this tier." />
    );
  }

  return (
    <div className="space-y-8">
      {/* Stats strip */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
          / Ultimate beneficial ownership · {stats.total} chain{stats.total === 1 ? '' : 's'} resolved
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/5 border border-white/5">
          <Stat label="Chains" value={String(stats.total)} />
          <Stat label="Resolved to person" value={`${stats.persons}`} sub={`${stats.total > 0 ? Math.round((stats.persons / stats.total) * 100) : 0}%`} />
          <Stat label="Offshore" value={String(stats.offshore)} highlight={stats.offshore > 0} />
          <Stat label="Deep (>4 layers)" value={String(stats.deep)} highlight={stats.deep > 0} />
          <Stat label="Top stake" value={`${stats.maxOwnership}%`} />
        </div>
      </section>

      {/* Flag filters */}
      <section>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2">filter</span>
          {(['OFFSHORE', 'DEEP', 'DEAD_END', 'CIRCULAR'] as const).map((f) => (
            <button
              key={f}
              onClick={() => toggleFlag(f)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                activeFlags.has(f) ? FLAG_COLOR[f] + ' border-current' : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
              }`}
            >
              {f}
            </button>
          ))}
          {activeFlags.size > 0 && (
            <button
              onClick={() => setActiveFlags(new Set())}
              className="ml-2 text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
            >
              clear →
            </button>
          )}
        </div>
      </section>

      {/* Chain list */}
      <section className="space-y-4">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">
          / Chains ({filtered.length}{filtered.length !== chains.length ? ` of ${chains.length}` : ''})
        </div>
        {filtered.length === 0 ? (
          <EmptyState message="No chains match the current filters." />
        ) : (
          <div className="space-y-3">
            {filtered.map((c) => (
              <ChainCard key={c.id} chain={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChainCard({ chain }: { chain: UboChain }) {
  return (
    <div className="border border-white/5 bg-ink-850 p-5">
      {/* Header line */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <span className="text-2xl font-medium text-ink-50 tabular-nums">
          {chain.effectiveOwnershipPct}%
        </span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-ink-500">
          effective stake
        </span>
        <span className="ml-auto text-[10px] font-mono text-ink-500">
          {chain.terminationReason}
        </span>
        {chain.flags.map((f) => (
          <span
            key={f}
            className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${FLAG_COLOR[f]}`}
          >
            {f}
          </span>
        ))}
      </div>

      {/* Path — UBO at top, root company at bottom */}
      <ol className="space-y-1">
        {chain.path.map((node, i) => {
          const isLast = i === chain.path.length - 1;
          const isFirst = i === 0;
          return (
            <li key={i} className="flex items-start gap-3">
              {/* Tree gutter */}
              <div className="flex flex-col items-center pt-1 shrink-0" style={{ width: 18 }}>
                <div
                  className={`w-2 h-2 rounded-full ${
                    isFirst ? (node.kind === 'person' ? 'bg-signal-clean' : 'bg-signal-medium') : 'bg-ink-600'
                  }`}
                />
                {!isLast && <div className="w-px flex-1 bg-white/10 mt-1" style={{ minHeight: 16 }} />}
              </div>
              {/* Node body */}
              <div className="flex-1 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[9px] font-mono uppercase tracking-wider text-ink-600">
                    L{node.level} · {node.kind}
                  </span>
                  {isFirst && <span className="text-[9px] font-mono text-signal-clean">UBO</span>}
                  {isLast && <span className="text-[9px] font-mono text-ink-400">ROOT</span>}
                </div>
                <div className="text-sm text-ink-50 mt-0.5">{node.name}</div>
                <div className="text-[10px] font-mono text-ink-500 mt-0.5 flex items-center gap-3 flex-wrap">
                  {node.companyNumber && <span>№ {node.companyNumber}</span>}
                  {node.jurisdiction && (
                    <span
                      className={
                        /british virgin|cayman|panama|seychelles|marshall|belize|bahamas|bermuda|mauritius|jersey|guernsey|isle of man/i.test(
                          node.jurisdiction,
                        )
                          ? 'text-signal-critical'
                          : ''
                      }
                    >
                      ⌖ {node.jurisdiction}
                    </span>
                  )}
                  {node.ownershipPct != null && (
                    <span className="text-ink-300">holds {node.ownershipPct}% of next ↓</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Stat({ label, value, highlight, sub }: { label: string; value: string; highlight?: boolean; sub?: string }) {
  return (
    <div className={`bg-ink-850 p-5 ${highlight ? 'border-l-2 border-signal-critical' : ''}`}>
      <div className="text-2xl font-medium text-ink-50 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-2 font-mono">{label}</div>
      {sub && <div className="text-[10px] text-ink-600 mt-0.5 font-mono">{sub}</div>}
    </div>
  );
}
