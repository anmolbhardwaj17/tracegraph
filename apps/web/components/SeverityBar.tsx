'use client';

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

interface Props {
  counts: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  active?: Set<string>;
  onToggle?: (sev: Sev) => void;
}

export function SeverityBar({ counts, active, onToggle }: Props) {
  const total = counts.CRITICAL + counts.HIGH + counts.MEDIUM + counts.LOW;
  if (total === 0) {
    return <div className="h-2 rounded-sm bg-white/5 w-full" />;
  }
  const pct = (n: number) => (n / total) * 100;
  const interactive = !!onToggle;
  const isDimmed = (s: Sev) => active && active.size > 0 && !active.has(s);

  const seg = (s: Sev, color: string) => (
    counts[s] > 0 && (
      <button
        type="button"
        disabled={!interactive}
        onClick={() => onToggle?.(s)}
        className={`${color} transition-opacity ${interactive ? 'cursor-pointer hover:opacity-90' : ''} ${isDimmed(s) ? 'opacity-25' : 'opacity-100'}`}
        style={{ width: `${pct(counts[s])}%` }}
        title={`${counts[s]} ${s.toLowerCase()}`}
      />
    )
  );

  return (
    <div className="space-y-3">
      <div className="h-2 w-full flex rounded-sm overflow-hidden bg-white/5">
        {seg('CRITICAL', 'bg-signal-critical')}
        {seg('HIGH', 'bg-signal-high')}
        {seg('MEDIUM', 'bg-signal-medium')}
        {seg('LOW', 'bg-ink-700')}
      </div>

      <div className="grid grid-cols-4 gap-px bg-white/5 border border-white/5">
        <SevCount sev="CRITICAL" label="CRITICAL" count={counts.CRITICAL} className="text-signal-critical" active={active} onToggle={onToggle} />
        <SevCount sev="HIGH" label="HIGH" count={counts.HIGH} className="text-signal-high" active={active} onToggle={onToggle} />
        <SevCount sev="MEDIUM" label="MEDIUM" count={counts.MEDIUM} className="text-signal-medium" active={active} onToggle={onToggle} />
        <SevCount sev="LOW" label="LOW" count={counts.LOW} className="text-ink-300" active={active} onToggle={onToggle} />
      </div>
    </div>
  );
}

function SevCount({
  sev, label, count, className, active, onToggle,
}: {
  sev: Sev; label: string; count: number; className: string;
  active?: Set<string>; onToggle?: (s: Sev) => void;
}) {
  const interactive = !!onToggle;
  const dimmed = active && active.size > 0 && !active.has(sev);
  const selected = active && active.has(sev);
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => onToggle?.(sev)}
      className={`bg-ink-850 p-4 text-left transition-colors ${interactive ? 'cursor-pointer hover:bg-ink-900' : ''} ${selected ? 'ring-1 ring-inset ring-white/20' : ''} ${dimmed ? 'opacity-40' : ''}`}
    >
      <div className={`text-3xl font-medium tabular-nums ${className}`}>{count}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">{label}</div>
    </button>
  );
}
