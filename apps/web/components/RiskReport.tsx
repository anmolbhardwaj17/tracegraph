'use client';
import { useState } from 'react';

interface Finding {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  evidence: string[];
  affectedEntities: string[];
  recommendation: string;
}

export function RiskGauge({ score }: { score: number }) {
  const color = score >= 60 ? '#FF4D4D' : score >= 30 ? '#F5C518' : '#5EE6A1';
  const label = score >= 60 ? 'HIGH RISK' : score >= 30 ? 'ELEVATED' : 'LOW RISK';
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, score) / 100) * circumference;

  return (
    <div className="relative w-56 h-56 flex items-center justify-center">
      <svg className="w-56 h-56 -rotate-90" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="80" cy="80" r={radius} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.2,0.8,0.2,1)', filter: `drop-shadow(0 0 8px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[10px] font-mono tracking-[0.15em] text-ink-500 mb-1">RISK SCORE</div>
        <div className="text-6xl font-medium text-ink-50 tabular-nums tracking-tight">{score}</div>
        <div className="text-[10px] font-mono tracking-[0.2em] mt-2" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}

export function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const sevColors: Record<string, string> = {
    CRITICAL: 'bg-signal-critical/15 text-signal-critical border-signal-critical/40',
    HIGH: 'bg-signal-high/15 text-signal-high border-signal-high/40',
    MEDIUM: 'bg-signal-medium/15 text-signal-medium border-signal-medium/40',
    LOW: 'bg-white/5 text-ink-300 border-white/10',
  };
  return (
    <div className="border border-white/5 bg-ink-850 hover:border-white/10 transition-colors">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-4 min-w-0">
          <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border ${sevColors[finding.severity]}`}>
            {finding.severity}
          </span>
          <span className="font-medium text-sm text-ink-50 truncate">{finding.title}</span>
        </div>
        <span className="text-ink-500 text-sm font-mono shrink-0 ml-3">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm space-y-4 border-t border-white/5">
          <p className="text-ink-300 leading-relaxed pt-3">{finding.description}</p>
          {finding.evidence.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Evidence</div>
              <ul className="space-y-1">
                {finding.evidence.map((e, i) => (
                  <li key={i} className="text-ink-300 text-xs flex gap-2">
                    <span className="text-ink-500">›</span>
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finding.affectedEntities.length > 0 && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Affected entities</div>
              <div className="text-ink-400 text-[10px] font-mono">
                {finding.affectedEntities.slice(0, 8).join('  ·  ')}
                {finding.affectedEntities.length > 8 ? `  +${finding.affectedEntities.length - 8} more` : ''}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Recommendation</div>
            <p className="text-ink-300 text-xs">{finding.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
