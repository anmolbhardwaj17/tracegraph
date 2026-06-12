'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, X, ExternalLink, AlertCircle, Zap } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export default function SetupPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/setup/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <main className="min-h-screen bg-ink-900 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-ink-700 border-t-ink-50 rounded-full animate-spin" />
    </main>
  );

  return (
    <main className="min-h-screen bg-ink-900 text-ink-50">
      {/* Header */}
      <header className="border-b border-white/5 px-8 py-5">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
          <span className="text-sm font-medium">TraceGraph</span>
          <span className="text-ink-700">·</span>
          <span className="text-xs font-mono text-ink-500">Setup</span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-8 py-12">
        {/* Status badge */}
        <div className="flex items-center gap-3 mb-8">
          {status?.ready ? (
            <div className="flex items-center gap-2 px-4 py-2 border border-signal-clean/30 bg-signal-clean/8 text-signal-clean">
              <Zap size={14} />
              <span className="text-sm font-medium">Ready to investigate</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 border border-signal-medium/30 bg-signal-medium/8 text-signal-medium">
              <AlertCircle size={14} />
              <span className="text-sm font-medium">Configuration required</span>
            </div>
          )}
        </div>

        <h1 className="text-2xl font-medium text-ink-50 mb-2">TraceGraph Setup</h1>
        <p className="text-sm text-ink-500 mb-10 leading-relaxed">
          Configure your API keys to unlock M&A due diligence capabilities.
          Required keys are needed for core functionality; optional keys extend coverage.
        </p>

        {/* Config items */}
        <div className="space-y-3 mb-10">
          {status?.items?.map((item: any) => (
            <div key={item.key} className={`border p-5 ${item.configured ? 'border-white/5 bg-ink-850' : item.required ? 'border-signal-medium/20 bg-signal-medium/5' : 'border-white/5 bg-ink-850'}`}>
              <div className="flex items-start gap-4">
                <div className={`mt-0.5 shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${item.configured ? 'bg-signal-clean/20' : item.required ? 'bg-signal-medium/20' : 'bg-white/5'}`}>
                  {item.configured
                    ? <Check size={11} className="text-signal-clean" />
                    : <X size={11} className={item.required ? 'text-signal-medium' : 'text-ink-600'} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-ink-100">{item.label}</span>
                    <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 border rounded-sm ${item.required ? 'text-signal-medium border-signal-medium/30 bg-signal-medium/10' : 'text-ink-600 border-white/10 bg-white/5'}`}>
                      {item.required ? 'Required' : 'Optional'}
                    </span>
                    {item.configured && (
                      <span className="text-[8px] font-mono text-signal-clean">Configured ✓</span>
                    )}
                  </div>
                  <p className="text-xs text-ink-500 leading-relaxed">{item.description}</p>
                  {!item.configured && (
                    <div className="mt-3 flex items-center gap-3">
                      <code className="text-[10px] font-mono bg-ink-900 border border-white/10 px-2 py-1 text-ink-400">
                        {item.key}=your_key_here
                      </code>
                      {item.docsUrl && (
                        <a href={item.docsUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] font-mono text-ink-500 hover:text-ink-300 transition-colors">
                          <ExternalLink size={10} />
                          Get key
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Quick start */}
        <div className="border border-white/5 bg-ink-850 p-6 mb-8">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">Quick start</div>
          <div className="space-y-3 text-xs font-mono text-ink-400">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-600 mb-1">1. Copy environment file</div>
              <code className="block bg-ink-900 border border-white/5 px-3 py-2 text-ink-300">cp .env.example .env</code>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-600 mb-1">2. Add your API keys</div>
              <code className="block bg-ink-900 border border-white/5 px-3 py-2 text-ink-300">nano .env  # or your preferred editor</code>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-600 mb-1">3. Start the stack</div>
              <code className="block bg-ink-900 border border-white/5 px-3 py-2 text-ink-300">docker-compose up</code>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-ink-600 mb-1">Or run locally</div>
              <code className="block bg-ink-900 border border-white/5 px-3 py-2 text-ink-300">npm install && npm run dev</code>
            </div>
          </div>
        </div>

        {/* Feature status */}
        {status?.features && (
          <div className="border border-white/5 bg-ink-850 p-6 mb-8">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">Feature status</div>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(status.features).map(([key, enabled]) => {
                const labels: Record<string, string> = {
                  ukInvestigations: 'UK company investigations',
                  aiChat: 'Tracey AI + IC memo generator',
                  emailAlerts: 'Watchlist email alerts',
                  googleAuth: 'Google login',
                  globalCompanies: 'Global company coverage',
                };
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-signal-clean' : 'bg-ink-700'}`} />
                    <span className={`text-xs ${enabled ? 'text-ink-300' : 'text-ink-600'}`}>{labels[key] || key}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {status?.ready && (
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-ink-50 text-ink-900 text-sm font-medium hover:bg-white transition-colors"
          >
            Start investigating →
          </Link>
        )}
      </div>
    </main>
  );
}
