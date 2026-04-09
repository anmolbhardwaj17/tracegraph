'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Insight {
  title: string;
  body: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
}

type InsightTopic = 'overview' | 'findings' | 'entities';

const TOPIC_LABELS: Record<InsightTopic, string> = {
  overview: '/ Key insights',
  findings: '/ Findings analysis',
  entities: '/ Network composition',
};

export function Insights({
  investigationId,
  topic = 'overview',
}: {
  investigationId: string;
  topic?: InsightTopic;
}) {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInsights(null);
    setError(null);
    fetch(`${API}/api/investigations/${investigationId}/insights?topic=${topic}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setInsights(data.insights || []);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [investigationId, topic]);

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">{TOPIC_LABELS[topic]}</div>
        <div className="text-[10px] font-mono text-ink-500">AI ANALYSIS</div>
      </div>

      {!insights && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border border-white/5 bg-ink-850 p-5 animate-pulse">
              <div className="h-3 w-32 bg-white/5 rounded-sm mb-3" />
              <div className="h-2 w-full bg-white/5 rounded-sm mb-2" />
              <div className="h-2 w-3/4 bg-white/5 rounded-sm" />
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-signal-critical text-sm font-mono">{error}</div>}

      {insights && insights.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((ins, i) => (
            <InsightCard key={i} insight={ins} />
          ))}
        </div>
      )}
      {insights && insights.length === 0 && (
        <div className="text-center py-8 text-ink-500 text-sm font-mono">no insights available</div>
      )}
    </section>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const sevColors: Record<string, string> = {
    CRITICAL: 'text-signal-critical border-signal-critical/30',
    HIGH: 'text-signal-high border-signal-high/30',
    MEDIUM: 'text-signal-medium border-signal-medium/30',
    INFO: 'text-ink-300 border-white/10',
  };
  return (
    <div className="border border-white/5 bg-ink-850 p-5 hover:border-white/10 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${sevColors[insight.severity] || sevColors.INFO}`}>
          {insight.severity}
        </span>
      </div>
      <h3 className="font-medium text-sm text-ink-50 mb-2 leading-snug">{insight.title}</h3>
      <p className="text-xs text-ink-300 leading-relaxed">{insight.body}</p>
    </div>
  );
}
