'use client';
import { useState } from 'react';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface CompanySummary {
  id: string;
  query: string;
  companyName: string;
  riskScore: number;
  findingsCount: number;
  severityBreakdown: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  counts: { companies: number; people: number; addresses: number; edges: number };
}

interface CompareResult {
  a: CompanySummary;
  b: CompanySummary;
  sharedDirectors: Array<{ label: string }>;
  sharedAddresses: Array<{ label: string }>;
  sharedDirectorsCount: number;
  sharedAddressesCount: number;
}

export default function ComparePage() {
  const [queryA, setQueryA] = useState('');
  const [queryB, setQueryB] = useState('');
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingInvs, setLoadingInvs] = useState(false);

  async function loadInvestigations() {
    setLoadingInvs(true);
    try {
      const res = await fetch(`${API}/api/investigations`);
      const data = await res.json();
      setInvestigations(data.filter((i: any) => i.status === 'COMPLETE'));
    } catch {}
    setLoadingInvs(false);
  }

  async function compare() {
    if (!selectedA || !selectedB) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/investigations/compare?a=${selectedA}&b=${selectedB}`);
      const data = await res.json();
      setResult(data);
    } catch {}
    setLoading(false);
  }

  // Load investigations on mount
  if (investigations.length === 0 && !loadingInvs) loadInvestigations();

  const scoreColor = (s: number) =>
    s >= 75 ? 'text-signal-critical' : s >= 50 ? 'text-signal-high' : s >= 25 ? 'text-signal-medium' : 'text-signal-clean';

  return (
    <main className="min-h-screen bg-ink-950 text-ink-50">
      <div className="max-w-6xl mx-auto px-8 py-16">
        <div className="flex items-baseline justify-between mb-10">
          <div>
            <h1 className="text-2xl font-medium">Company Comparison</h1>
            <p className="text-sm text-ink-500 mt-1 font-mono">
              select two completed investigations to compare side by side
            </p>
          </div>
          <Link href="/" className="text-xs font-mono text-ink-500 hover:text-ink-50 transition-colors">
            ← back to search
          </Link>
        </div>

        {/* Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2 block">/ Company A</label>
            <select
              value={selectedA}
              onChange={(e) => setSelectedA(e.target.value)}
              className="w-full px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 focus:outline-none focus:border-white/30 font-mono"
            >
              <option value="">Select investigation…</option>
              {investigations.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.companyName || inv.query} ({inv.riskScore != null ? `score ${inv.riskScore}` : 'unscored'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2 block">/ Company B</label>
            <select
              value={selectedB}
              onChange={(e) => setSelectedB(e.target.value)}
              className="w-full px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 focus:outline-none focus:border-white/30 font-mono"
            >
              <option value="">Select investigation…</option>
              {investigations.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.companyName || inv.query} ({inv.riskScore != null ? `score ${inv.riskScore}` : 'unscored'})
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={compare}
          disabled={!selectedA || !selectedB || selectedA === selectedB || loading}
          className="px-6 py-3 bg-ink-50 text-ink-900 text-sm font-medium rounded-sm hover:bg-ink-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mb-12"
        >
          {loading ? 'Comparing…' : 'Compare'}
        </button>

        {result && (
          <div className="space-y-10">
            {/* Side-by-side summary */}
            <section>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Summary</div>
              <div className="grid grid-cols-2 gap-6">
                <SummaryCard data={result.a} label="A" />
                <SummaryCard data={result.b} label="B" />
              </div>
            </section>

            {/* Shared connections */}
            <section>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
                / Hidden connections · {result.sharedDirectorsCount + result.sharedAddressesCount} shared
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-white/5 bg-ink-850 p-6">
                  <div className="text-3xl font-medium text-ink-50 tabular-nums">{result.sharedDirectorsCount}</div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono mb-4">Shared directors</div>
                  {result.sharedDirectors.length > 0 ? (
                    <ul className="space-y-1">
                      {result.sharedDirectors.map((d, i) => (
                        <li key={i} className="text-sm text-ink-300">› {d.label}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs font-mono text-ink-600">no shared directors found</div>
                  )}
                </div>
                <div className="border border-white/5 bg-ink-850 p-6">
                  <div className="text-3xl font-medium text-ink-50 tabular-nums">{result.sharedAddressesCount}</div>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono mb-4">Shared addresses</div>
                  {result.sharedAddresses.length > 0 ? (
                    <ul className="space-y-1">
                      {result.sharedAddresses.map((a, i) => (
                        <li key={i} className="text-sm text-ink-300 truncate">› {a.label}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs font-mono text-ink-600">no shared addresses found</div>
                  )}
                </div>
              </div>
            </section>

            {/* Links to full investigations */}
            <section className="flex items-center gap-4">
              <Link
                href={`/investigate/${result.a.id}`}
                className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors"
              >
                view {result.a.companyName} investigation →
              </Link>
              <Link
                href={`/investigate/${result.b.id}`}
                className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors"
              >
                view {result.b.companyName} investigation →
              </Link>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ data, label }: { data: CompanySummary; label: string }) {
  const scoreColor = (s: number) =>
    s >= 75 ? 'text-signal-critical' : s >= 50 ? 'text-signal-high' : s >= 25 ? 'text-signal-medium' : 'text-signal-clean';

  return (
    <div className="border border-white/5 bg-ink-850 p-6 space-y-4">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-1">company {label}</div>
        <div className="text-lg font-medium text-ink-50 truncate">{data.companyName || data.query}</div>
      </div>

      <div className="flex items-end gap-6">
        <div>
          <div className={`text-4xl font-medium tabular-nums ${scoreColor(data.riskScore || 0)}`}>{data.riskScore ?? '-'}</div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">risk score</div>
        </div>
        <div>
          <div className="text-lg font-medium text-ink-50 tabular-nums">{data.findingsCount}</div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">findings</div>
        </div>
      </div>

      <div className="flex gap-3 text-[10px] font-mono">
        {data.severityBreakdown.CRITICAL > 0 && <span className="text-signal-critical">{data.severityBreakdown.CRITICAL} CRIT</span>}
        {data.severityBreakdown.HIGH > 0 && <span className="text-signal-high">{data.severityBreakdown.HIGH} HIGH</span>}
        {data.severityBreakdown.MEDIUM > 0 && <span className="text-signal-medium">{data.severityBreakdown.MEDIUM} MED</span>}
        {data.severityBreakdown.LOW > 0 && <span className="text-ink-400">{data.severityBreakdown.LOW} LOW</span>}
      </div>

      <div className="grid grid-cols-3 gap-px bg-white/5 border border-white/5 mt-3">
        <div className="bg-ink-900 p-3 text-center">
          <div className="text-sm font-medium text-ink-50 tabular-nums">{data.counts?.companies || 0}</div>
          <div className="text-[9px] font-mono text-ink-500 mt-0.5">companies</div>
        </div>
        <div className="bg-ink-900 p-3 text-center">
          <div className="text-sm font-medium text-ink-50 tabular-nums">{data.counts?.people || 0}</div>
          <div className="text-[9px] font-mono text-ink-500 mt-0.5">people</div>
        </div>
        <div className="bg-ink-900 p-3 text-center">
          <div className="text-sm font-medium text-ink-50 tabular-nums">{data.counts?.addresses || 0}</div>
          <div className="text-[9px] font-mono text-ink-500 mt-0.5">addresses</div>
        </div>
      </div>
    </div>
  );
}
