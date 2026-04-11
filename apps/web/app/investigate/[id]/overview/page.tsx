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
    Promise.all([
      fetch(`${API}/api/investigations/${id}/overview`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/locations`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/investigations/${id}/matches`).then((r) => r.json()).catch(() => null),
    ])
      .then(([overview, locations, matchData]) => {
        const addresses = locations?.addresses || [];
        const jurisdictions = new Set<string>();
        for (const a of addresses) {
          const country = a.metadata?.geo?.displayName?.split(',').pop()?.trim() || a.metadata?.country || a.label?.split(',').pop()?.trim();
          if (country && country.length > 1) jurisdictions.add(country.toLowerCase());
        }
        // Count risky entities from findings
        const riskyEntities = new Set<string>();
        for (const f of overview.findings || []) {
          if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
            for (const eid of f.affectedEntities || []) riskyEntities.add(eid);
          }
        }
        setData({
          ...overview,
          addressCount: addresses.length,
          jurisdictionCount: jurisdictions.size,
          sanctionsMatches: (matchData?.matches || []).length,
          riskyEntityCount: riskyEntities.size,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Skeleton />;
  if (!data) return <div className="text-ink-500 text-sm font-mono">Failed to load overview</div>;

  const score = data.riskScore ?? 0;
  const scoreColor = score >= 75 ? 'text-signal-critical' : score >= 50 ? 'text-signal-high' : score >= 25 ? 'text-signal-medium' : 'text-signal-clean';
  const ringColor = score >= 75 ? '#FF4D4D' : score >= 50 ? '#FF8A3D' : score >= 25 ? '#F5C518' : '#5EE6A1';
  const circumference = 2 * Math.PI * 45;
  const progress = (score / 100) * circumference;
  const classification = data.riskClassification || (score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW');

  // Fallback: compute breakdown from score if not provided by backend
  if (!data.scoreBreakdown && score > 0) {
    const sanctionFindings = (data.findings || []).filter((f: any) => f.type === 'SANCTIONS_PROXIMITY' || f.type === 'HIGH_RISK_JURISDICTION');
    const directorFindings = (data.findings || []).filter((f: any) => f.type === 'DISQUALIFIED_DIRECTOR' || f.type === 'DIRECTOR_VELOCITY' || f.type === 'DIRECTOR_NOMINEE_PATTERN');
    data.scoreBreakdown = {
      sanctions: Math.min(40, sanctionFindings.length * 10),
      structural: Math.min(40, Math.max(0, score - sanctionFindings.length * 10 - directorFindings.length * 5)),
      director: Math.min(20, directorFindings.length * 5),
    };
  }

  const findings = data.findings || [];
  const topActions = findings.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3);
  const remainingFindings = findings.filter((f: any) => !topActions.includes(f));

  return (
    <div className="space-y-8">
      {/* ROW 1: Score gauge (narrow) + Network numbers (wide) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Score gauge */}
        <div className="lg:col-span-4 border border-white/5 bg-ink-850 p-6 flex items-center gap-6">
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
              <circle cx="50" cy="50" r="45" fill="none" stroke={ringColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-3xl font-medium tabular-nums ${scoreColor}`}>{score}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">{data.targetCompany}'s risk profile</div>
            <div className={`text-xl font-medium ${scoreColor}`}>{classification}</div>
            {data.percentile != null && data.benchmarks?.totalInvestigations >= 3 && (
              <div className="text-xs text-ink-400 mt-2">Higher than {data.percentile}% of investigated companies</div>
            )}
            <div className="text-[10px] font-mono text-ink-500 mt-3">{findings.length} findings detected</div>
          </div>
        </div>

        {/* Network numbers */}
        <div className="lg:col-span-8 border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-5">{data.targetCompany}'s network</div>
          <div className="grid grid-cols-4 gap-6">
            <div>
              <div className="text-3xl font-medium text-ink-50 tabular-nums">{data.counts?.people || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">directors & officers</div>
            </div>
            <div>
              <div className="text-3xl font-medium text-ink-50 tabular-nums">{data.counts?.companies || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">connected companies</div>
            </div>
            <div>
              <div className={`text-3xl font-medium tabular-nums ${data.riskyEntityCount > 0 ? 'text-signal-critical' : 'text-signal-clean'}`}>{data.riskyEntityCount || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">flagged entities</div>
            </div>
            <div>
              <div className={`text-3xl font-medium tabular-nums ${data.sanctionsMatches > 0 ? 'text-signal-critical' : 'text-signal-clean'}`}>{data.sanctionsMatches || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">sanctions matches</div>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: AI Insights + Globe */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Insights */}
        <div className="lg:col-span-6">
          <Insights investigationId={id} topic="overview" />
        </div>

        {/* Globe */}
        <div className="lg:col-span-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">
            Geographic footprint
            <span className="text-ink-400 ml-3 normal-case tracking-normal">{data.addressCount || 0} addresses - {data.jurisdictionCount || 0} jurisdiction{(data.jurisdictionCount || 0) === 1 ? '' : 's'}</span>
          </div>
          <div className="border border-white/5 bg-ink-850 relative overflow-hidden min-h-[280px]">
            <NetworkGlobe />
          </div>
        </div>
      </div>

      {/* ROW 3: Score breakdown - compact strip */}
      <div className="border border-white/5 bg-ink-850 px-6 py-4">
        <div className="flex items-center gap-8 flex-wrap">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 shrink-0">Risk breakdown</div>
          {[
            { label: 'Sanctions', value: data.scoreBreakdown?.sanctions, max: 40, color: 'bg-signal-critical' },
            { label: 'Structural', value: data.scoreBreakdown?.structural, max: 40, color: 'bg-signal-high' },
            { label: 'Director', value: data.scoreBreakdown?.director, max: 20, color: 'bg-signal-medium' },
          ].map((bar) => (
            <div key={bar.label} className="flex items-center gap-3 flex-1 min-w-[140px]">
              <span className="text-[10px] text-ink-400 shrink-0">{bar.label}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${bar.color} rounded-full`} style={{ width: `${((bar.value || 0) / bar.max) * 100}%` }} />
              </div>
              <span className="text-[10px] font-mono text-ink-500 tabular-nums shrink-0">{bar.value || 0}/{bar.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ROW 4: Top 3 actions */}
      {topActions.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Immediate attention required</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topActions.map((f: any, i: number) => (
              <div key={i} className="border border-white/5 bg-ink-850 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
                    f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                    'bg-signal-high/15 text-signal-high border-signal-high/30'
                  }`}>{f.severity}</span>
                  <span className="text-[9px] font-mono text-ink-600">{f.type}</span>
                </div>
                <div className="text-sm text-ink-50 mb-3 leading-snug">{f.title}</div>
                {f.businessImpact && (
                  <p className="text-[11px] text-ink-400 leading-relaxed mb-3">{f.businessImpact.slice(0, 150)}...</p>
                )}
                {f.verificationSteps && f.verificationSteps.length > 0 && (
                  <div className="space-y-1">
                    {f.verificationSteps.slice(0, 2).map((s: string, si: number) => (
                      <div key={si} className="text-[10px] text-ink-500 flex gap-1.5">
                        <span className="text-ink-600 shrink-0">{si + 1}.</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ROW 5: Remaining findings */}
      {remainingFindings.length > 0 && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            Key risk signals in {data.targetCompany}'s network ({remainingFindings.length})
          </div>
          <div className="space-y-2">
            {remainingFindings.slice(0, 10).map((f: any, i: number) => (
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
            {remainingFindings.length > 10 && (
              <div className="text-[10px] font-mono text-ink-500 pt-2">+ {remainingFindings.length - 10} more findings</div>
            )}
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
      <div className="grid grid-cols-2 gap-6">
        <div className="h-56 bg-white/5 rounded-sm" />
        <div className="h-56 bg-white/5 rounded-sm" />
      </div>
      <div className="h-40 bg-white/5 rounded-sm" />
    </div>
  );
}
