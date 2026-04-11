'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function OverviewPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/overview`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([overview, meta]) => setData({ ...overview, ...meta }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Skeleton />;
  if (!data) return <div className="text-ink-500 text-sm font-mono">Failed to load overview</div>;

  return (
    <div className="space-y-8">
      {/* Score */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">Risk score</div>
          <div className={`text-5xl font-medium tabular-nums ${
            (data.riskScore || 0) >= 75 ? 'text-signal-critical' :
            (data.riskScore || 0) >= 50 ? 'text-signal-high' :
            (data.riskScore || 0) >= 25 ? 'text-signal-medium' : 'text-signal-clean'
          }`}>{data.riskScore ?? '-'}</div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">{data.riskClassification || '-'}</div>
          {data.percentile != null && data.benchmarks?.totalInvestigations >= 3 && (
            <div className="text-xs text-ink-400 mt-3">
              Higher than {data.percentile}% of investigated companies
            </div>
          )}
        </div>
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">Findings</div>
          <div className="text-3xl font-medium text-ink-50 tabular-nums">{(data.findings || []).length}</div>
          <div className="flex gap-3 mt-3 text-[10px] font-mono">
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => {
              const count = (data.findings || []).filter((f: any) => f.severity === s).length;
              if (!count) return null;
              const color = s === 'CRITICAL' ? 'text-signal-critical' : s === 'HIGH' ? 'text-signal-high' : s === 'MEDIUM' ? 'text-signal-medium' : 'text-ink-400';
              return <span key={s} className={color}>{count} {s}</span>;
            })}
          </div>
        </div>
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">Network</div>
          <div className="grid grid-cols-3 gap-4 mt-2">
            <div>
              <div className="text-xl font-medium text-ink-50 tabular-nums">{data.counts?.companies || 0}</div>
              <div className="text-[9px] font-mono text-ink-500 mt-0.5">companies</div>
            </div>
            <div>
              <div className="text-xl font-medium text-ink-50 tabular-nums">{data.counts?.people || 0}</div>
              <div className="text-[9px] font-mono text-ink-500 mt-0.5">people</div>
            </div>
            <div>
              <div className="text-xl font-medium text-ink-50 tabular-nums">{data.counts?.addresses || 0}</div>
              <div className="text-[9px] font-mono text-ink-500 mt-0.5">addresses</div>
            </div>
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      {data.scoreBreakdown && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">Score breakdown</div>
          <div className="space-y-3">
            {[
              { label: 'Sanctions exposure', value: data.scoreBreakdown.sanctions, max: 40 },
              { label: 'Structural risk', value: data.scoreBreakdown.structural, max: 40 },
              { label: 'Director risk', value: data.scoreBreakdown.director, max: 20 },
            ].map((bar) => (
              <div key={bar.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-ink-400">{bar.label}</span>
                  <span className="text-xs font-mono text-ink-300 tabular-nums">{bar.value || 0} / {bar.max}</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-signal-clean rounded-full transition-all" style={{ width: `${((bar.value || 0) / bar.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top findings preview */}
      {(data.findings || []).length > 0 && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">Top findings</div>
          <div className="space-y-2">
            {(data.findings || []).slice(0, 5).map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-b-0">
                <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border shrink-0 ${
                  f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                  f.severity === 'HIGH' ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
                  'bg-signal-medium/15 text-signal-medium border-signal-medium/30'
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
      <div className="grid grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-white/5 rounded-sm" />)}
      </div>
      <div className="h-40 bg-white/5 rounded-sm" />
    </div>
  );
}
