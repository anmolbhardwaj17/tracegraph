'use client';
import { useMemo, useRef, useState, useEffect } from 'react';

interface TimelineEvent {
  date: string;
  type: string;
  title: string;
  context?: string;
  severity: string;
}

interface Props {
  events: TimelineEvent[];
  targetCompany: string;
  height?: number;
}

const LANE_HEIGHT = 56;
const LANE_LABELS = ['Company', 'Directors', 'Ownership', 'Alerts'];
const LABEL_WIDTH = 90;
const TOP_AXIS = 28;
const TOTAL_LANES = 4;

const EVENT_LANE: Record<string, number> = {
  incorporation: 0, dissolution: 0,
  appointment: 1, resignation: 1,
  psc: 2,
  anomaly: 3, filing: 3,
};

const EVENT_COLOR: Record<string, string> = {
  incorporation: '#5EE6A1', dissolution: '#EF4444',
  appointment: '#5EE6A1', resignation: '#EF4444',
  psc: '#60A5FA',
  anomaly: '#EF4444', filing: '#F59E0B',
};

function formatDateShort(d: string) {
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

export function SwimLaneTimeline({ events, targetCompany, height: containerHeight = 400 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; evt: TimelineEvent } | null>(null);
  const [selected, setSelected] = useState<TimelineEvent | null>(null);

  // Filter to dated events only
  const datedEvents = useMemo(() =>
    events.filter((e) => e.date).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
  [events]);

  const undatedEvents = useMemo(() => events.filter((e) => !e.date), [events]);

  // Time range
  const { minTime, maxTime, totalYears, pxPerMs, svgWidth } = useMemo(() => {
    if (datedEvents.length === 0) return { minTime: 0, maxTime: 0, totalYears: 0, pxPerMs: 0, svgWidth: 800 };
    const times = datedEvents.map((e) => new Date(e.date).getTime());
    const mn = Math.min(...times);
    const mx = Math.max(...times, Date.now());
    const years = Math.max(1, (mx - mn) / (365 * 24 * 60 * 60 * 1000));
    const px = years > 5 ? 200 / (365 * 24 * 60 * 60 * 1000) : 100 / (30 * 24 * 60 * 60 * 1000);
    const w = Math.max(800, (mx - mn) * px + 100);
    return { minTime: mn, maxTime: mx, totalYears: years, pxPerMs: px, svgWidth: w };
  }, [datedEvents]);

  const timeToX = (date: string) => (new Date(date).getTime() - minTime) * pxPerMs + 20;

  // Year markers
  const yearMarkers = useMemo(() => {
    if (minTime === 0) return [];
    const markers: Array<{ year: number; x: number }> = [];
    const startYear = new Date(minTime).getFullYear();
    const endYear = new Date(maxTime).getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      const x = (new Date(y, 0, 1).getTime() - minTime) * pxPerMs + 20;
      if (x >= 0) markers.push({ year: y, x });
    }
    return markers;
  }, [minTime, maxTime, pxPerMs]);

  // Cluster detection (3+ events in 30 days)
  const clusters = useMemo(() => {
    const DAY30 = 30 * 24 * 60 * 60 * 1000;
    const result: Array<{ startX: number; endX: number; count: number }> = [];
    const times = datedEvents.map((e) => new Date(e.date).getTime());
    for (let i = 0; i < times.length; i++) {
      let j = i;
      while (j < times.length && times[j] - times[i] < DAY30) j++;
      if (j - i >= 3) {
        result.push({
          startX: timeToX(datedEvents[i].date),
          endX: timeToX(datedEvents[j - 1].date) + 10,
          count: j - i,
        });
        i = j - 1;
      }
    }
    return result;
  }, [datedEvents, timeToX]);

  // Target company incorporation line
  const targetIncX = useMemo(() => {
    const inc = datedEvents.find((e) => e.type === 'incorporation' && e.title?.includes(targetCompany));
    return inc ? timeToX(inc.date) : null;
  }, [datedEvents, targetCompany, timeToX]);

  // Scroll to end (most recent) on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [svgWidth]);

  // Horizontal scroll with mouse wheel
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const svgH = TOP_AXIS + LANE_HEIGHT * TOTAL_LANES;

  if (datedEvents.length < 10) return null; // Let parent use vertical fallback

  return (
    <div className="border border-white/5 bg-ink-900 overflow-hidden">
      <div className="flex">
        {/* Fixed lane labels */}
        <div className="shrink-0 border-r border-white/5 bg-ink-850" style={{ width: LABEL_WIDTH }}>
          <div style={{ height: TOP_AXIS }} className="border-b border-white/5" />
          {LANE_LABELS.map((label, i) => (
            <div key={i} className="flex items-center px-3 border-b border-white/5 text-[10px] font-mono text-ink-500 uppercase tracking-wider" style={{ height: LANE_HEIGHT }}>
              {label}
            </div>
          ))}
        </div>

        {/* Scrollable SVG area */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide">
          <svg width={svgWidth} height={svgH} className="block">
            {/* Year markers */}
            {yearMarkers.map((m) => (
              <g key={m.year}>
                <line x1={m.x} y1={0} x2={m.x} y2={svgH} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
                <text x={m.x + 4} y={18} fill="#525252" fontSize={10} fontFamily="ui-monospace, monospace">{m.year}</text>
              </g>
            ))}

            {/* Lane separators */}
            {LANE_LABELS.map((_, i) => (
              <line key={i} x1={0} y1={TOP_AXIS + LANE_HEIGHT * i} x2={svgWidth} y2={TOP_AXIS + LANE_HEIGHT * i} stroke="rgba(255,255,255,0.04)" />
            ))}

            {/* Target incorporation vertical line */}
            {targetIncX != null && (
              <line x1={targetIncX} y1={0} x2={targetIncX} y2={svgH} stroke="rgba(94,230,161,0.2)" strokeWidth={1} strokeDasharray="4,4" />
            )}

            {/* Today vertical line */}
            <line x1={(Date.now() - minTime) * pxPerMs + 20} y1={0} x2={(Date.now() - minTime) * pxPerMs + 20} y2={svgH} stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="3,3" />

            {/* Cluster highlights */}
            {clusters.map((cl, i) => (
              <rect key={i} x={cl.startX - 5} y={TOP_AXIS} width={cl.endX - cl.startX + 10} height={LANE_HEIGHT * TOTAL_LANES}
                fill="rgba(239,68,68,0.06)" rx={3} />
            ))}

            {/* Event dots */}
            {datedEvents.map((evt, i) => {
              const x = timeToX(evt.date);
              const lane = EVENT_LANE[evt.type] ?? 3;
              const y = TOP_AXIS + lane * LANE_HEIGHT + LANE_HEIGHT / 2;
              const color = EVENT_COLOR[evt.type] || '#6B7280';
              const isTarget = evt.title?.includes(targetCompany);
              const r = isTarget && evt.type === 'incorporation' ? 8 : 5;

              return (
                <g key={i}
                  onMouseEnter={(e) => {
                    const rect = scrollRef.current?.getBoundingClientRect();
                    if (rect) setTooltip({ x: e.clientX - rect.left + scrollRef.current!.scrollLeft, y: e.clientY - rect.top, evt });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  onClick={() => setSelected(evt)}
                  style={{ cursor: 'pointer' }}
                >
                  {isTarget && evt.type === 'incorporation' && (
                    <circle cx={x} cy={y} r={12} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
                  )}
                  <circle cx={x} cy={y} r={r} fill={color} opacity={isTarget ? 1 : 0.7} />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Fixed right: recent events */}
        <div className="shrink-0 border-l border-white/5 bg-ink-850 w-56 p-3 overflow-y-auto" style={{ maxHeight: svgH }}>
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-3">Recent</div>
          {datedEvents.slice(-5).reverse().map((evt, i) => (
            <button key={i} onClick={() => setSelected(evt)} className="w-full text-left py-1.5 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT_CLS[evt.severity] || 'bg-ink-500'}`} />
                <span className="text-[10px] text-ink-300 truncate">{evt.title}</span>
              </div>
              <div className="text-[9px] font-mono text-ink-600 ml-3">{evt.date?.slice(0, 10)}</div>
            </button>
          ))}
          {undatedEvents.length > 0 && (
            <>
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mt-4 mb-2">Findings</div>
              {undatedEvents.slice(0, 3).map((evt, i) => (
                <button key={i} onClick={() => setSelected(evt)} className="w-full text-left py-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEV_DOT_CLS[evt.severity] || 'bg-ink-500'}`} />
                    <span className="text-[10px] text-ink-300 truncate">{evt.title}</span>
                  </div>
                </button>
              ))}
              {undatedEvents.length > 3 && <div className="text-[9px] text-ink-600 font-mono">+{undatedEvents.length - 3} more</div>}
            </>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed pointer-events-none bg-ink-900 border border-white/10 text-ink-50 text-xs rounded-sm px-3 py-2 shadow-2xl z-50 max-w-xs"
          style={{ left: tooltip.x + 16, top: tooltip.y + 16 }}>
          <div className="font-medium">{tooltip.evt.title}</div>
          {tooltip.evt.date && <div className="text-ink-500 text-[10px] font-mono mt-0.5">{formatDateShort(tooltip.evt.date)}</div>}
          {tooltip.evt.context && <div className="text-ink-400 text-[10px] mt-1">{tooltip.evt.context}</div>}
        </div>
      )}

      {/* Selected event detail panel */}
      {selected && (
        <div className="border-t border-white/5 bg-ink-850 px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-2 h-2 rounded-full ${SEV_DOT_CLS[selected.severity] || 'bg-ink-500'}`} />
              <span className="text-sm text-ink-50 font-medium">{selected.title}</span>
              <span className="text-[9px] font-mono text-ink-600 uppercase">{selected.type}</span>
            </div>
            {selected.date && <div className="text-xs text-ink-500 font-mono">{formatDateShort(selected.date)}</div>}
            {selected.context && <div className="text-xs text-ink-400 mt-1">{selected.context}</div>}
          </div>
          <button onClick={() => setSelected(null)} className="text-ink-500 hover:text-ink-50 text-lg leading-none shrink-0">x</button>
        </div>
      )}
    </div>
  );
}

const SEV_DOT_CLS: Record<string, string> = { critical: 'bg-signal-critical', warning: 'bg-signal-medium', info: 'bg-ink-500' };
