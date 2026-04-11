'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SEV_DOT: Record<string, string> = {
  critical: 'bg-signal-critical',
  warning: 'bg-signal-medium',
  info: 'bg-ink-500',
};

const DAY = 24 * 60 * 60 * 1000;

export default function TimelinePage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [fullHistory, setFullHistory] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/investigations/${id}/timeline?limit=200${fullHistory ? '&fullHistory=true' : ''}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, fullHistory]);

  const events = data?.events || [];
  const filtered = filter === 'all' ? events : events.filter((e: any) => e.severity === filter);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Array<{ date: string; events: any[] }> = [];
    let currentDate = '';
    for (const e of filtered) {
      const d = e.date?.slice(0, 10) || 'Undated';
      if (d !== currentDate) {
        groups.push({ date: d, events: [e] });
        currentDate = d;
      } else {
        groups[groups.length - 1].events.push(e);
      }
    }
    return groups;
  }, [filtered]);

  // Detect suspicious clusters (3+ events within 30 days)
  const clusterDates = useMemo(() => {
    const clusters = new Set<string>();
    const dated = filtered.filter((e: any) => e.date).map((e: any) => ({
      date: e.date.slice(0, 10),
      ts: new Date(e.date).getTime(),
    }));
    for (let i = 0; i < dated.length; i++) {
      let count = 1;
      for (let j = i + 1; j < dated.length && dated[j].ts - dated[i].ts < 30 * DAY; j++) {
        count++;
      }
      if (count >= 3) {
        for (let j = i; j < dated.length && dated[j].ts - dated[i].ts < 30 * DAY; j++) {
          clusters.add(dated[j].date);
        }
      }
    }
    return clusters;
  }, [filtered]);

  if (loading) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  if (!data) return <div className="text-ink-500 text-sm font-mono">Failed to load timeline</div>;

  return (
    <div className="space-y-8">
      {/* Key moments */}
      {(data.keyMoments || []).length > 0 && (
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Key moments - {data.targetCompany}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {data.keyMoments.map((km: any, i: number) => (
              <div key={i} className="border border-white/5 bg-ink-850 p-4">
                <div className={`w-2 h-2 rounded-full mb-3 ${SEV_DOT[km.severity] || 'bg-ink-500'}`} />
                <div className="text-xs text-ink-50 leading-snug mb-1">{km.title}</div>
                {km.date && <div className="text-[10px] font-mono text-ink-500">{km.date.slice(0, 10)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-1">filter</span>
        {(['all', 'critical', 'warning'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
              filter === f ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10'
            }`}
          >
            {f}
          </button>
        ))}
        <button
          onClick={() => setFullHistory(!fullHistory)}
          className={`text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors ml-2 ${
            fullHistory ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10'
          }`}
        >
          {fullHistory ? 'showing full history' : 'show full history'}
        </button>
        <span className="ml-auto text-[10px] font-mono text-ink-500">
          {filtered.length} events{data.capped ? ` (capped at 200 of ${data.total})` : ''}
        </span>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-[72px] top-0 bottom-0 w-px bg-white/5" />

        {grouped.map((group, gi) => {
          const isCluster = group.events.some((e: any) => e.date && clusterDates.has(e.date.slice(0, 10)));
          return (
            <div key={gi} className={isCluster ? 'bg-signal-critical/[0.03] -mx-4 px-4 py-1 border-l-2 border-signal-critical/20 mb-1' : 'mb-0'}>
              {isCluster && group.events.length >= 3 && (
                <div className="text-[9px] font-mono text-signal-critical/60 mb-1 ml-20">
                  Activity cluster - {group.events.length} events
                </div>
              )}
              {group.events.map((evt: any, ei: number) => (
                <div key={ei} className="flex items-start gap-4 py-2 hover:bg-white/[0.01]">
                  <div className="w-16 shrink-0 text-right">
                    {ei === 0 && evt.date && (
                      <div className="text-[10px] font-mono text-ink-500 tabular-nums">{evt.date.slice(0, 10)}</div>
                    )}
                  </div>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 relative z-10 ${SEV_DOT[evt.severity] || 'bg-ink-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink-50">{evt.title}</div>
                    {evt.context && <div className="text-[10px] text-ink-400 mt-0.5">{evt.context}</div>}
                  </div>
                  <div className="text-[9px] font-mono text-ink-600 uppercase tracking-wider shrink-0">{evt.type}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
