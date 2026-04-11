'use client';
import { useMemo, useState } from 'react';

interface Props {
  entities?: { company: any[]; person: any[]; address: any[] };
  findings?: any[];
  edges?: any[];
}

interface TimelineEvent {
  date: string;
  timestamp: number;
  type: 'incorporation' | 'dissolution' | 'appointment' | 'resignation' | 'filing' | 'anomaly' | 'psc';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail?: string;
  entityLabel?: string;
}

const SEV_DOT: Record<string, string> = {
  critical: 'bg-signal-critical',
  warning: 'bg-signal-medium',
  info: 'bg-ink-500',
};

export function TimelineTab({ entities, findings, edges }: Props) {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning'>('all');

  const { events, keyMoments } = useMemo(() => {
    const evts: TimelineEvent[] = [];

    // Company events
    for (const c of entities?.company || []) {
      if (c.metadata?.incorporationDate) {
        evts.push({
          date: c.metadata.incorporationDate,
          timestamp: new Date(c.metadata.incorporationDate).getTime(),
          type: 'incorporation',
          severity: 'info',
          title: `${c.label} incorporated`,
          entityLabel: c.label,
        });
      }
      if (c.metadata?.dissolutionDate) {
        evts.push({
          date: c.metadata.dissolutionDate,
          timestamp: new Date(c.metadata.dissolutionDate).getTime(),
          type: 'dissolution',
          severity: 'warning',
          title: `${c.label} dissolved`,
          entityLabel: c.label,
        });
      }
      // Filing health events
      const fh = c.metadata?.filingHealth;
      if (fh?.band === 'POOR') {
        evts.push({
          date: c.metadata?.accountsMadeUpTo || c.metadata?.incorporationDate || '',
          timestamp: new Date(c.metadata?.accountsMadeUpTo || c.metadata?.incorporationDate || 0).getTime(),
          type: 'filing',
          severity: 'warning',
          title: `${c.label} - poor filing health (score ${fh.score})`,
          detail: fh.reasons?.join(', '),
          entityLabel: c.label,
        });
      }
    }

    // Director events from edges
    for (const e of edges || []) {
      if (e.type !== 'director' && e.type !== 'appointment') continue;
      const meta = e.metadata || {};
      const personLabel = findLabel(entities, e.source) || findLabel(entities, e.target) || 'Director';
      const companyLabel = findCompanyLabel(entities, e.source) || findCompanyLabel(entities, e.target) || '';

      if (meta.appointedOn) {
        evts.push({
          date: meta.appointedOn,
          timestamp: new Date(meta.appointedOn).getTime(),
          type: 'appointment',
          severity: 'info',
          title: `${personLabel} appointed`,
          detail: companyLabel ? `to ${companyLabel}` : undefined,
          entityLabel: personLabel,
        });
      }
      if (meta.resignedOn) {
        evts.push({
          date: meta.resignedOn,
          timestamp: new Date(meta.resignedOn).getTime(),
          type: 'resignation',
          severity: 'info',
          title: `${personLabel} resigned`,
          detail: companyLabel ? `from ${companyLabel}` : undefined,
          entityLabel: personLabel,
        });
      }
    }

    // Findings as anomaly events
    for (const f of findings || []) {
      evts.push({
        date: '',
        timestamp: 0,
        type: 'anomaly',
        severity: f.severity === 'CRITICAL' ? 'critical' : f.severity === 'HIGH' ? 'warning' : 'info',
        title: f.title,
        detail: f.type,
        entityLabel: f.affectedEntities?.[0],
      });
    }

    // Sort by date (anomalies without dates go to end)
    evts.sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp - b.timestamp;
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return 0;
    });

    // Key moments: first incorporation, first dissolution, any CRITICAL finding, any disqualification, any sanctions match
    const keys: TimelineEvent[] = [];
    const firstInc = evts.find((e) => e.type === 'incorporation');
    if (firstInc) keys.push(firstInc);
    const firstDiss = evts.find((e) => e.type === 'dissolution');
    if (firstDiss) keys.push(firstDiss);
    const criticals = evts.filter((e) => e.severity === 'critical').slice(0, 3);
    keys.push(...criticals);
    // Dedupe
    const uniqueKeys = keys.filter((k, i) => keys.findIndex((k2) => k2.title === k.title) === i).slice(0, 5);

    return { events: evts, keyMoments: uniqueKeys };
  }, [entities, findings, edges]);

  const filtered = filter === 'all' ? events : events.filter((e) => e.severity === filter);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Array<{ date: string; events: TimelineEvent[] }> = [];
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

  // Detect suspicious clusters (5+ events in same week)
  const clusterWeeks = useMemo(() => {
    const weeks = new Set<string>();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const dated = events.filter((e) => e.timestamp > 0);
    for (let i = 0; i < dated.length; i++) {
      let count = 1;
      for (let j = i + 1; j < dated.length && dated[j].timestamp - dated[i].timestamp < WEEK; j++) {
        count++;
      }
      if (count >= 5) {
        const weekStart = new Date(dated[i].timestamp).toISOString().slice(0, 10);
        weeks.add(weekStart);
      }
    }
    return weeks;
  }, [events]);

  if (events.length === 0) {
    return <div className="text-center py-16 text-ink-500 text-sm font-mono">/ no timeline events available</div>;
  }

  return (
    <div className="space-y-8">
      {/* Key moments */}
      {keyMoments.length > 0 && (
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Key moments</div>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {keyMoments.map((km, i) => (
              <div key={i} className="border border-white/5 bg-ink-850 p-4">
                <div className={`w-2 h-2 rounded-full mb-3 ${SEV_DOT[km.severity]}`} />
                <div className="text-xs text-ink-50 leading-snug mb-1">{km.title}</div>
                {km.date && <div className="text-[10px] font-mono text-ink-500">{km.date.slice(0, 10)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2">show</span>
        {(['all', 'critical', 'warning'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
              filter === f ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-mono text-ink-500">{filtered.length} events</span>
      </div>

      {/* Timeline */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-6">/ Timeline ({filtered.length} events)</div>
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[72px] top-0 bottom-0 w-px bg-white/5" />

          {grouped.map((group, gi) => {
            const isCluster = clusterWeeks.has(group.date);
            return (
              <div key={gi} className={`mb-1 ${isCluster ? 'bg-signal-critical/[0.03] -mx-4 px-4 py-2 border-l-2 border-signal-critical/20' : ''}`}>
                {group.events.map((evt, ei) => (
                  <div key={ei} className="flex items-start gap-4 py-2 group hover:bg-white/[0.01]">
                    {/* Date */}
                    <div className="w-16 shrink-0 text-right">
                      {ei === 0 && evt.date && (
                        <div className="text-[10px] font-mono text-ink-500 tabular-nums">{evt.date.slice(0, 10)}</div>
                      )}
                    </div>
                    {/* Dot */}
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 relative z-10 ${SEV_DOT[evt.severity]}`} />
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink-50">{evt.title}</div>
                      {evt.detail && <div className="text-[10px] font-mono text-ink-500 mt-0.5">{evt.detail}</div>}
                    </div>
                    {/* Type badge */}
                    <div className="text-[9px] font-mono text-ink-600 uppercase tracking-wider shrink-0">{evt.type}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function findLabel(entities: any, nodeId: string): string | undefined {
  for (const group of ['person', 'company', 'address'] as const) {
    const found = (entities?.[group] || []).find((e: any) => e.id === nodeId);
    if (found?.entityType === 'person') return found.label;
  }
  return undefined;
}

function findCompanyLabel(entities: any, nodeId: string): string | undefined {
  for (const c of entities?.company || []) {
    if (c.id === nodeId) return c.label;
  }
  return undefined;
}
