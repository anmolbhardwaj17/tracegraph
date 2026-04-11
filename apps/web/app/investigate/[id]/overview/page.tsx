'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Insights } from '../../../../components/Insights';
import { NetworkGlobe } from '../../../../components/NetworkGlobe';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function OverviewPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/investigations/${id}/overview`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Skeleton />;
  if (!data) return <div className="text-ink-500 text-sm font-mono">Failed to load overview</div>;

  const score = data.riskScore ?? 0;
  const scoreColor = score >= 75 ? 'text-signal-critical' : score >= 50 ? 'text-signal-high' : score >= 25 ? 'text-signal-medium' : 'text-signal-clean';
  const circumference = 2 * Math.PI * 45;
  const progress = (score / 100) * circumference;

  return (
    <div className="space-y-8">
      {/* Hero: Score gauge + Company context */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Score with circular gauge */}
        <div className="border border-white/5 bg-ink-850 p-8 flex items-center gap-8">
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
              <circle
                cx="50" cy="50" r="45" fill="none"
                stroke={score >= 75 ? '#FF4D4D' : score >= 50 ? '#FF8A3D' : score >= 25 ? '#F5C518' : '#5EE6A1'}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${progress} ${circumference}`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-3xl font-medium tabular-nums ${scoreColor}`}>{score}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">
              {data.targetCompany}'s risk profile
            </div>
            <div className={`text-xl font-medium ${scoreColor}`}>
              {data.riskClassification || (score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW')}
            </div>
            {data.percentile != null && data.benchmarks?.totalInvestigations >= 3 && (
              <div className="text-xs text-ink-400 mt-2">
                Higher than {data.percentile}% of investigated companies
              </div>
            )}
          </div>
        </div>

        {/* Globe / geographic context */}
        <div className="border border-white/5 bg-ink-850 relative overflow-hidden min-h-[200px]">
          <div className="absolute top-5 left-5 z-10 space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">Geographic footprint</div>
            <div className="text-xs text-ink-400">
              {data.counts?.addresses || 0} addresses
            </div>
          </div>
          <NetworkGlobe />
        </div>
      </div>

      {/* Score breakdown */}
      {data.scoreBreakdown && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            {data.targetCompany} - score breakdown
          </div>
          <div className="space-y-3">
            {[
              { label: 'Sanctions exposure', value: data.scoreBreakdown.sanctions, max: 40, color: 'bg-signal-critical' },
              { label: 'Structural risk', value: data.scoreBreakdown.structural, max: 40, color: 'bg-signal-high' },
              { label: 'Director risk', value: data.scoreBreakdown.director, max: 20, color: 'bg-signal-medium' },
            ].map((bar) => (
              <div key={bar.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-ink-400">{bar.label}</span>
                  <span className="text-xs font-mono text-ink-300 tabular-nums">{bar.value || 0} / {bar.max}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full ${bar.color} rounded-full transition-all`} style={{ width: `${((bar.value || 0) / bar.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights */}
      <Insights investigationId={id} topic="overview" />

      {/* Network composition */}
      <div className="border border-white/5 bg-ink-850 p-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
          {data.targetCompany}'s network
        </div>
        <div className="grid grid-cols-3 gap-px bg-white/5">
          <div className="bg-ink-900 p-5 text-center">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{data.counts?.companies || 0}</div>
            <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">companies</div>
          </div>
          <div className="bg-ink-900 p-5 text-center">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{data.counts?.people || 0}</div>
            <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">people</div>
          </div>
          <div className="bg-ink-900 p-5 text-center">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{data.counts?.addresses || 0}</div>
            <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">addresses</div>
          </div>
        </div>
      </div>

      {/* Key risk entities */}
      {(data.findings || []).length > 0 && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            Key risk signals in {data.targetCompany}'s network
          </div>
          <div className="space-y-2">
            {(data.findings || []).slice(0, 8).map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-b-0">
                <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border shrink-0 ${
                  f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                  f.severity === 'HIGH' ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
                  f.severity === 'MEDIUM' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
                  'bg-white/5 text-ink-400 border-white/10'
                }`}>{f.severity}</span>
                <span className="text-xs text-ink-300 truncate">{f.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="h-48 bg-white/5 rounded-sm" />
        <div className="h-48 bg-white/5 rounded-sm" />
      </div>
      <div className="h-32 bg-white/5 rounded-sm" />
      <div className="h-48 bg-white/5 rounded-sm" />
    </div>
  );
}
