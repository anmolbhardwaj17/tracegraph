'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, ExternalLink } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export default function SharedInvestigationPage() {
  const { token } = useParams() as { token: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/api/shared/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Failed to load investigation'))
      .finally(() => setLoading(false));
  }, [token]);

  const score = data?.riskScore ?? 0;
  const scoreColor = score >= 75 ? 'text-signal-critical' : score >= 50 ? 'text-signal-high' : score >= 25 ? 'text-signal-medium' : 'text-signal-clean';

  if (loading) return (
    <main className="min-h-screen bg-ink-900 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-ink-600 border-t-ink-50 rounded-full animate-spin" />
    </main>
  );

  if (error || !data) return (
    <main className="min-h-screen bg-ink-900 flex flex-col items-center justify-center gap-4">
      <Lock size={28} className="text-ink-600" />
      <div className="text-sm text-ink-500">{error || 'Investigation not found'}</div>
      <Link href="/" className="text-xs font-mono text-ink-600 hover:text-ink-400 transition-colors">Return to TraceGraph</Link>
    </main>
  );

  return (
    <main className="min-h-screen bg-ink-900 text-ink-50">
      {/* Header */}
      <header className="border-b border-white/5 px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
          <span className="text-sm font-medium">TraceGraph</span>
          <span className="text-ink-700">·</span>
          <span className="text-xs font-mono text-ink-500">Shared report</span>
        </div>
        <Link href="/" className="text-[10px] font-mono text-ink-500 hover:text-ink-300 transition-colors flex items-center gap-1">
          <ExternalLink size={10} />
          Open in TraceGraph
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        {/* Target */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-600 mb-1">Acquisition target</div>
          <h1 className="text-2xl font-medium text-ink-50">{data.companyName}</h1>
          {data.completedAt && (
            <div className="text-xs font-mono text-ink-600 mt-1">
              Investigated {new Date(data.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          )}
        </div>

        {/* Score + verdict */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-2">Deal risk score</div>
            <div className={`text-4xl font-medium tabular-nums ${scoreColor}`}>{score}</div>
            <div className={`text-xs font-mono mt-1 ${scoreColor}`}>{data.riskClassification}</div>
          </div>
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-2">Compliance snapshot</div>
            <div className="space-y-2 mt-1">
              <div className="flex justify-between text-xs">
                <span className="text-ink-500">PEPs in network</span>
                <span className={data.pepCount > 0 ? 'text-signal-high font-medium' : 'text-signal-clean'}>{data.pepCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-ink-500">Sanctions matches</span>
                <span className={data.sanctionsMatches > 0 ? 'text-signal-critical font-medium' : 'text-signal-clean'}>{data.sanctionsMatches}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Narrative */}
        {data.narrative && (
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3">Executive summary</div>
            <p className="text-sm text-ink-300 leading-relaxed">{data.narrative}</p>
          </div>
        )}

        {/* Top findings */}
        {data.findings?.length > 0 && (
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3">
              Key findings ({data.findings.length} shown)
            </div>
            <div className="space-y-2">
              {data.findings.map((f: any, i: number) => (
                <div key={i} className="flex items-start gap-2 py-2 border-b border-white/5 last:border-b-0">
                  <span className={`text-[7px] font-mono uppercase tracking-wider px-1.5 py-0.5 border rounded-sm shrink-0 mt-0.5 ${
                    f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                    f.severity === 'HIGH' ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
                    'bg-signal-medium/15 text-signal-medium border-signal-medium/30'
                  }`}>{f.severity}</span>
                  <span className="text-xs text-ink-300 leading-snug">{f.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-white/5 pt-6 flex items-center justify-between">
          <div className="text-[9px] font-mono text-ink-700">
            This report is shared read-only. Data sourced from public registries via TraceGraph.
          </div>
          <Link href="/" className="text-[10px] font-mono text-ink-500 hover:text-ink-300 transition-colors">
            Run your own investigation →
          </Link>
        </div>
      </div>
    </main>
  );
}
