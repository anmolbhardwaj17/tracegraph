'use client';

interface Props {
  status: string;
  live: { entities: number; edges: number; depth: number; apiCalls: number; matches: number };
}

const STAGES = [
  { key: 'FETCHING', label: 'Fetching company' },
  { key: 'EXPANDING', label: 'Expanding network' },
  { key: 'RESOLVING', label: 'Resolving entities' },
  { key: 'SCORING', label: 'Detecting anomalies' },
  { key: 'COMPLETE', label: 'Scoring risk' },
];

const ORDER = ['QUEUED', 'FETCHING', 'EXPANDING', 'RESOLVING', 'SCORING', 'COMPLETE'];

export function ProgressView({ status, live }: Props) {
  const currentIdx = ORDER.indexOf(status);
  return (
    <div className="space-y-8">
      {/* Stage indicator */}
      <ol className="space-y-3">
        {STAGES.map((stage, i) => {
          const stageIdx = ORDER.indexOf(stage.key);
          const isActive = currentIdx === stageIdx;
          const isDone = currentIdx > stageIdx;
          return (
            <li key={stage.key} className="flex items-center gap-3">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                  isDone
                    ? 'bg-emerald-500 text-white'
                    : isActive
                    ? 'bg-blue-500 text-white animate-pulse'
                    : 'bg-slate-200 text-slate-400'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              <span className={`text-sm ${isActive ? 'font-medium text-slate-900' : isDone ? 'text-slate-700' : 'text-slate-400'}`}>
                {stage.label}
              </span>
              {isActive && <span className="text-xs text-slate-400 ml-auto">in progress…</span>}
            </li>
          );
        })}
      </ol>

      {/* Live counters */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
        <Counter label="Entities" value={live.entities} />
        <Counter label="Connections" value={live.edges} />
        <Counter label="Depth" value={live.depth} />
        <Counter label="API calls" value={live.apiCalls} />
        <Counter label="Matches" value={live.matches} />
      </div>

      {/* Mini graph preview */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 h-48 flex items-center justify-center">
        <MiniGraph entities={live.entities} edges={live.edges} />
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 text-center">
      <div className="text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function MiniGraph({ entities, edges }: { entities: number; edges: number }) {
  // Compose deterministic positions for n dots
  const n = Math.min(entities, 60);
  if (n === 0) {
    return <div className="text-sm text-slate-400">Waiting for first entity…</div>;
  }
  const dots = Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    const radius = 60 + (i % 3) * 12;
    return {
      cx: 150 + Math.cos(angle) * radius,
      cy: 80 + Math.sin(angle) * radius * 0.7,
    };
  });
  return (
    <svg viewBox="0 0 300 160" className="w-full h-full">
      {/* Subtle connecting lines */}
      {dots.slice(1).map((d, i) => (
        <line
          key={`l-${i}`}
          x1={dots[0].cx} y1={dots[0].cy}
          x2={d.cx} y2={d.cy}
          stroke="#CBD5E1"
          strokeWidth="0.5"
          opacity="0.5"
        />
      ))}
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r={i === 0 ? 6 : 3}
          fill={i === 0 ? '#3B82F6' : i % 3 === 0 ? '#10B981' : '#3B82F6'}
          opacity={0.85}
          style={{ animation: `fadeIn 0.5s ease-out` }}
        />
      ))}
      <text x="150" y="155" textAnchor="middle" fontSize="10" fill="#64748B">
        {entities} entities · {edges} connections
      </text>
    </svg>
  );
}
