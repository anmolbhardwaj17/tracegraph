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
  const color = score >= 60 ? '#DC2626' : score >= 30 ? '#F59E0B' : '#10B981';
  const label = score >= 60 ? 'HIGH RISK' : score >= 30 ? 'ELEVATED' : 'LOW RISK';
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, score) / 100) * circumference;

  return (
    <div className="relative w-48 h-48 flex items-center justify-center">
      <svg className="w-48 h-48 -rotate-90" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="12" />
        <circle
          cx="80" cy="80" r={radius} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-bold text-slate-900">{score}</div>
        <div className="text-[10px] tracking-wider text-slate-500 mt-1" style={{ color }}>{label}</div>
      </div>
    </div>
  );
}

export function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const sevColors: Record<string, string> = {
    CRITICAL: 'bg-red-600 text-white',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-amber-400 text-slate-900',
    LOW: 'bg-slate-200 text-slate-700',
  };
  return (
    <div className="border border-slate-200 rounded-lg bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xs px-2 py-0.5 rounded ${sevColors[finding.severity]}`}>{finding.severity}</span>
          <span className="font-medium text-sm truncate">{finding.title}</span>
        </div>
        <span className="text-slate-400 text-xs">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 text-sm space-y-3">
          <p className="text-slate-700">{finding.description}</p>
          {finding.evidence.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Evidence</div>
              <ul className="list-disc list-inside text-slate-700 space-y-0.5">
                {finding.evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {finding.affectedEntities.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Affected entities</div>
              <div className="text-slate-700 text-xs font-mono">{finding.affectedEntities.slice(0, 8).join(', ')}{finding.affectedEntities.length > 8 ? ` +${finding.affectedEntities.length - 8} more` : ''}</div>
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Recommendation</div>
            <p className="text-slate-700">{finding.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}
