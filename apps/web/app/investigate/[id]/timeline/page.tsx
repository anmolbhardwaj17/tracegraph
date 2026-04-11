'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SEV_DOT: Record<string, string> = { critical: 'bg-signal-critical', warning: 'bg-signal-medium', info: 'bg-ink-500' };

export default function TimelinePage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/investigations/${id}/timeline?limit=200&fullHistory=true`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([tl, m]) => { setData(tl); setMeta(m); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const events = data?.events || [];
  const targetName = data?.targetCompany || meta?.companyName || 'This company';
  const filtered = filter === 'all' ? events : events.filter((e: any) => e.severity === filter);

  // CHANGE 1: Narrative summary
  const narrative = useMemo(() => {
    if (events.length === 0) return '';
    const incEvent = events.find((e: any) => e.type === 'incorporation' && e.title?.includes(targetName));
    const appointments = events.filter((e: any) => e.type === 'appointment');
    const resignations = events.filter((e: any) => e.type === 'resignation');
    const dissolutions = events.filter((e: any) => e.type === 'dissolution');
    const anomalies = events.filter((e: any) => e.severity === 'critical' || e.severity === 'warning');

    const parts: string[] = [];
    if (incEvent?.date) {
      const founder = appointments.find((a: any) => a.date === incEvent.date);
      parts.push(`${targetName} was incorporated on ${formatDate(incEvent.date)}${founder ? ` by ${founder.title.replace(' appointed as director', '').replace(' appointed', '')}` : ''}.`);
    }

    const years = incEvent?.date ? Math.max(1, Math.round((Date.now() - new Date(incEvent.date).getTime()) / (365 * 24 * 60 * 60 * 1000))) : 0;
    if (years > 0) {
      parts.push(`Over ${years} year${years > 1 ? 's' : ''}, there have been ${appointments.length} director appointments, ${resignations.length} resignations, and ${dissolutions.length} related company dissolutions.`);
    }

    if (anomalies.length > 0) {
      const critCount = events.filter((e: any) => e.severity === 'critical').length;
      if (critCount > 0) parts.push(`${critCount} critical risk signal${critCount > 1 ? 's' : ''} detected in the network.`);
      else parts.push(`${anomalies.length} notable event${anomalies.length > 1 ? 's' : ''} identified.`);
    } else {
      parts.push('No unusual activity patterns detected.');
    }

    return parts.join(' ');
  }, [events, targetName]);

  // CHANGE 2: Activity density
  const densityBars = useMemo(() => {
    const dated = filtered.filter((e: any) => e.date).map((e: any) => new Date(e.date).getTime());
    if (dated.length < 2) return [];
    const min = Math.min(...dated);
    const max = Math.max(...dated, Date.now());
    const range = max - min;
    if (range === 0) return [];
    const bucketCount = Math.min(24, Math.max(8, Math.ceil(range / (90 * 24 * 60 * 60 * 1000)))); // ~quarterly
    const bucketSize = range / bucketCount;
    const buckets: number[] = new Array(bucketCount).fill(0);
    for (const t of dated) {
      const idx = Math.min(bucketCount - 1, Math.floor((t - min) / bucketSize));
      buckets[idx]++;
    }
    const maxCount = Math.max(...buckets, 1);
    const avg = buckets.reduce((s, b) => s + b, 0) / bucketCount;
    return buckets.map((count, i) => ({
      count,
      height: Math.max(4, (count / maxCount) * 40),
      color: count > avg * 2 ? '#EF4444' : count > avg ? '#F59E0B' : '#525252',
      startDate: new Date(min + i * bucketSize).toISOString().slice(0, 7),
    }));
  }, [filtered]);

  // CHANGE 3: Era-based grouping
  const eras = useMemo(() => {
    if (filtered.length === 0) return [];
    const incEvent = events.find((e: any) => e.type === 'incorporation' && e.title?.includes(targetName));
    const incTime = incEvent?.date ? new Date(incEvent.date).getTime() : 0;
    const sixMonths = 180 * 24 * 60 * 60 * 1000;
    const sixMonthsAgo = Date.now() - sixMonths;

    const result: Array<{ title: string; events: any[]; defaultOpen: boolean }> = [];

    const before = filtered.filter((e: any) => e.date && new Date(e.date).getTime() < incTime);
    const founding = filtered.filter((e: any) => e.date && new Date(e.date).getTime() >= incTime && new Date(e.date).getTime() < incTime + sixMonths);
    const operating = filtered.filter((e: any) => e.date && new Date(e.date).getTime() >= incTime + sixMonths && new Date(e.date).getTime() < sixMonthsAgo);
    const recent = filtered.filter((e: any) => e.date && new Date(e.date).getTime() >= sixMonthsAgo);
    const undated = filtered.filter((e: any) => !e.date);

    if (recent.length > 0) result.push({ title: `Recent activity (last 6 months) - ${recent.length} events`, events: recent, defaultOpen: true });
    if (operating.length > 0) result.push({ title: `Operating history - ${operating.length} events`, events: operating, defaultOpen: false });
    if (founding.length > 0) result.push({ title: `Founding period - ${founding.length} events`, events: founding, defaultOpen: false });
    if (before.length > 0) result.push({ title: `Before incorporation - ${before.length} events`, events: before, defaultOpen: false });
    if (undated.length > 0) result.push({ title: `Risk findings - ${undated.length} signals`, events: undated, defaultOpen: true });

    return result;
  }, [filtered, events, targetName]);

  // CHANGE 4: Better key moments
  const keyMoments = useMemo(() => {
    const moments: Array<{ title: string; date: string; why: string; severity: string }> = [];
    const incEvent = events.find((e: any) => e.type === 'incorporation' && e.title?.includes(targetName));
    if (incEvent) moments.push({ title: incEvent.title, date: incEvent.date, why: 'Company founded', severity: 'info' });

    // Most recent event
    const dated = events.filter((e: any) => e.date).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (dated[0] && dated[0] !== incEvent) {
      moments.push({ title: dated[0].title, date: dated[0].date, why: 'Most recent activity', severity: dated[0].severity });
    }

    // Critical findings
    const criticals = events.filter((e: any) => e.severity === 'critical').slice(0, 2);
    for (const c of criticals) moments.push({ title: c.title, date: c.date || '', why: 'Critical risk signal', severity: 'critical' });

    // Resignation clusters (3+ in 30 days)
    const resignations = events.filter((e: any) => e.type === 'resignation' && e.date);
    for (let i = 0; i < resignations.length; i++) {
      let count = 1;
      for (let j = i + 1; j < resignations.length; j++) {
        if (Math.abs(new Date(resignations[j].date).getTime() - new Date(resignations[i].date).getTime()) < 30 * 24 * 60 * 60 * 1000) count++;
      }
      if (count >= 3) {
        moments.push({ title: `${count} directors resigned within 30 days`, date: resignations[i].date, why: 'Activity cluster detected', severity: 'warning' });
        break;
      }
    }

    return moments.slice(0, 5);
  }, [events, targetName]);

  if (loading) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  if (!data || events.length === 0) return <div className="text-center py-16 text-ink-500 text-sm font-mono">/ no timeline events available</div>;

  return (
    <div className="space-y-6">
      {/* CHANGE 1: Narrative summary */}
      {narrative && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">/ Story of {targetName}</div>
          <p className="text-sm text-ink-300 leading-relaxed">{narrative}</p>
        </div>
      )}

      {/* CHANGE 4: Key moments strip */}
      {keyMoments.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {keyMoments.map((km, i) => (
            <div key={i} className="shrink-0 border border-white/5 bg-ink-850 p-4 w-56">
              <div className={`w-2 h-2 rounded-full mb-2 ${SEV_DOT[km.severity] || 'bg-ink-500'}`} />
              <div className="text-xs text-ink-50 leading-snug mb-1 line-clamp-2">{km.title}</div>
              <div className="text-[10px] text-ink-500 font-mono">{km.why}</div>
              {km.date && <div className="text-[10px] text-ink-600 font-mono mt-1">{km.date.slice(0, 10)}</div>}
            </div>
          ))}
        </div>
      )}

      {/* CHANGE 2: Activity density chart */}
      {densityBars.length > 0 && (
        <div className="border border-white/5 bg-ink-850 px-6 py-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">/ Activity over time</div>
          <div className="flex items-end gap-[2px] h-10">
            {densityBars.map((bar, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
                <div className="w-full rounded-sm transition-all" style={{ height: bar.height, backgroundColor: bar.color, minWidth: 3 }} />
                <div className="absolute -top-8 hidden group-hover:block bg-ink-900 border border-white/10 text-[9px] font-mono text-ink-300 px-2 py-1 rounded-sm whitespace-nowrap z-10">
                  {bar.startDate}: {bar.count} events
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[9px] font-mono text-ink-600">
            <span>{densityBars[0]?.startDate}</span>
            <span>{densityBars[densityBars.length - 1]?.startDate}</span>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider">filter</span>
        {(['all', 'critical', 'warning'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${filter === f ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10'}`}>
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-mono text-ink-500">{filtered.length} events</span>
      </div>

      {/* CHANGE 3: Era-based grouping */}
      {eras.map((era, ei) => (
        <EraSection key={ei} title={era.title} events={era.events} defaultOpen={era.defaultOpen}
          expandedEvent={expandedEvent} onExpand={setExpandedEvent} globalOffset={eras.slice(0, ei).reduce((s, e) => s + e.events.length, 0)} />
      ))}
    </div>
  );
}

function EraSection({ title, events, defaultOpen, expandedEvent, onExpand, globalOffset }: {
  title: string; events: any[]; defaultOpen: boolean;
  expandedEvent: number | null; onExpand: (i: number | null) => void; globalOffset: number;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border border-white/5 ${defaultOpen && title.includes('Recent') ? 'bg-ink-850/80 border-white/10' : 'bg-ink-850'}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-400">{title}</span>
        {open ? <ChevronDown size={14} className="text-ink-500" /> : <ChevronRight size={14} className="text-ink-500" />}
      </button>
      {open && (
        <div className="px-5 pb-4">
          <div className="relative">
            <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/5" />
            {events.map((evt: any, i: number) => {
              const idx = globalOffset + i;
              const isExpanded = expandedEvent === idx;
              return (
                <div key={i}>
                  <button onClick={() => onExpand(isExpanded ? null : idx)} className="flex items-start gap-3 w-full text-left py-2 hover:bg-white/[0.01] transition-colors">
                    <div className={`w-[14px] h-[14px] rounded-full mt-0.5 shrink-0 relative z-10 flex items-center justify-center ${SEV_DOT[evt.severity] || 'bg-ink-500'}`}>
                      {isExpanded && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-50">{evt.title}</span>
                        {evt.date && <span className="text-[9px] font-mono text-ink-600 shrink-0">{evt.date.slice(0, 10)}</span>}
                      </div>
                      {evt.context && <div className="text-[11px] text-ink-400 mt-0.5">{evt.context}</div>}
                    </div>
                    <span className="text-[9px] font-mono text-ink-600 uppercase tracking-wider shrink-0">{evt.type}</span>
                  </button>
                  {/* CHANGE 6: Expanded detail */}
                  {isExpanded && (
                    <div className="ml-7 mb-3 border border-white/5 bg-ink-900 p-4 text-xs text-ink-300 space-y-2">
                      <div><span className="text-ink-500">Type:</span> {evt.type}</div>
                      {evt.date && <div><span className="text-ink-500">Date:</span> {formatDate(evt.date)}</div>}
                      {evt.context && <div><span className="text-ink-500">Context:</span> {evt.context}</div>}
                      {evt.type === 'dissolution' && evt.date && (
                        <div className="text-signal-medium">Company dissolved</div>
                      )}
                      {evt.type === 'anomaly' && (
                        <div className="text-signal-critical font-mono text-[10px]">Risk finding - see Findings tab for full details</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return d; }
}
