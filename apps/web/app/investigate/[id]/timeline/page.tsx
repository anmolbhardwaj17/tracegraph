'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SEV_DOT: Record<string, string> = {
  critical: 'bg-signal-critical',
  warning: 'bg-signal-medium',
  info: 'bg-ink-500',
};

export default function TimelinePage() {
  const { id } = useParams() as { id: string };
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const LIMIT = 100;

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/investigations/${id}/timeline?page=${page}&limit=${LIMIT}`)
      .then((r) => r.json())
      .then((d) => {
        setEvents((prev) => page === 1 ? d.events : [...prev, ...d.events]);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, page]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.severity === filter);

  // Group by date
  const grouped: Array<{ date: string; events: any[] }> = [];
  let currentDate = '';
  for (const e of filtered) {
    const d = e.date?.slice(0, 10) || 'Undated';
    if (d !== currentDate) {
      grouped.push({ date: d, events: [e] });
      currentDate = d;
    } else {
      grouped[grouped.length - 1].events.push(e);
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter + count */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2">show</span>
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
        <span className="ml-auto text-[10px] font-mono text-ink-500">
          {filtered.length} of {total} events
        </span>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="absolute left-[72px] top-0 bottom-0 w-px bg-white/5" />
        {grouped.map((group, gi) => (
          <div key={gi}>
            {group.events.map((evt, ei) => (
              <div key={ei} className="flex items-start gap-4 py-2 hover:bg-white/[0.01]">
                <div className="w-16 shrink-0 text-right">
                  {ei === 0 && evt.date && (
                    <div className="text-[10px] font-mono text-ink-500 tabular-nums">{evt.date.slice(0, 10)}</div>
                  )}
                </div>
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 relative z-10 ${SEV_DOT[evt.severity] || 'bg-ink-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-50">{evt.title}</div>
                  {evt.detail && <div className="text-[10px] font-mono text-ink-500 mt-0.5">{evt.detail}</div>}
                </div>
                <div className="text-[9px] font-mono text-ink-600 uppercase tracking-wider shrink-0">{evt.type}</div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Load more */}
      {events.length < total && (
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={loading}
          className="w-full py-3 border border-white/10 text-xs font-mono uppercase tracking-wider text-ink-400 hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? 'loading...' : `Load more (${events.length} of ${total})`}
        </button>
      )}
    </div>
  );
}
