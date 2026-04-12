'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Dropdown } from '../../components/Dropdown';
import { Avatar } from '../../components/Avatar';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface CompanySummary {
  id: string;
  query: string;
  companyName: string;
  riskScore: number;
  findingsCount: number;
  severityBreakdown: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  counts: { companies: number; people: number; addresses: number; edges: number };
  profile: {
    status: string; companyType: string; incorporationDate: string;
    filingHealth: string; shellRisk: string; ownershipTransparency: string;
    directorsCount: number; matchCount: number;
  };
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
      const items = Array.isArray(data) ? data : data.items || [];
      setInvestigations(items.filter((i: any) => i.status === 'COMPLETE'));
    } catch {}
    setLoadingInvs(false);
  }

  async function compare() {
    if (!selectedA || !selectedB) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/investigations/compare?a=${selectedA}&b=${selectedB}`);
      setResult(await res.json());
    } catch {}
    setLoading(false);
  }

  if (investigations.length === 0 && !loadingInvs) loadInvestigations();

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-medium text-ink-50 mb-1">Company Comparison</h1>
        <p className="text-sm text-ink-500 font-mono mb-8">Side-by-side risk analysis of two companies</p>

        {/* Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2 block">/ Company A</label>
            <Dropdown
              value={selectedA}
              onChange={setSelectedA}
              options={[
                { value: '', label: 'Select investigation...' },
                ...investigations.map((inv: any) => ({
                  value: inv.id,
                  label: `${inv.companyName || inv.query} (score ${inv.riskScore ?? '-'})`,
                })),
              ]}
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2 block">/ Company B</label>
            <Dropdown
              value={selectedB}
              onChange={setSelectedB}
              options={[
                { value: '', label: 'Select investigation...' },
                ...investigations.map((inv: any) => ({
                  value: inv.id,
                  label: `${inv.companyName || inv.query} (score ${inv.riskScore ?? '-'})`,
                })),
              ]}
            />
          </div>
        </div>

        <button
          onClick={compare}
          disabled={!selectedA || !selectedB || selectedA === selectedB || loading}
          className="px-6 py-3 bg-ink-50 text-ink-900 text-sm font-medium rounded-sm hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed mb-10"
        >
          {loading ? 'Comparing...' : 'Compare'}
        </button>

        {result && (
          <div className="space-y-8">
            {/* Risk score comparison */}
            <div className="grid grid-cols-2 gap-6">
              <ScoreCard data={result.a} worse={result.a.riskScore > result.b.riskScore} />
              <ScoreCard data={result.b} worse={result.b.riskScore > result.a.riskScore} />
            </div>

            {/* Attribute comparison table */}
            <section className="border border-white/5">
              <div className="px-5 py-3 border-b border-white/5 bg-ink-900">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Attribute comparison</span>
              </div>
              <CompareRow label="Status" a={result.a.profile.status} b={result.b.profile.status} betterFn={(v) => v === 'active'} />
              <CompareRow label="Type" a={result.a.profile.companyType} b={result.b.profile.companyType} />
              <CompareRow label="Incorporated" a={result.a.profile.incorporationDate?.slice(0, 4) || '-'} b={result.b.profile.incorporationDate?.slice(0, 4) || '-'} />
              <CompareRow label="Filing health" a={result.a.profile.filingHealth} b={result.b.profile.filingHealth} betterFn={(v) => v === 'GOOD'} worseFn={(v) => v === 'POOR'} />
              <CompareRow label="Shell risk" a={result.a.profile.shellRisk} b={result.b.profile.shellRisk} betterFn={(v) => v === 'LOW'} worseFn={(v) => v === 'HIGH' || v === 'CRITICAL'} />
              <CompareRow label="Ownership" a={result.a.profile.ownershipTransparency} b={result.b.profile.ownershipTransparency} betterFn={(v) => v === 'TRANSPARENT'} worseFn={(v) => v === 'OPAQUE'} />
              <CompareRow label="Findings" a={String(result.a.findingsCount)} b={String(result.b.findingsCount)} betterFn={(v, o) => Number(v) < Number(o)} />
              <CompareRow label="Sanctions" a={String(result.a.profile.matchCount)} b={String(result.b.profile.matchCount)} betterFn={(v) => v === '0'} worseFn={(v) => Number(v) > 0} />
              <CompareRow label="Network size" a={`${result.a.counts.companies} cos`} b={`${result.b.counts.companies} cos`} />
            </section>

            {/* Shared connections */}
            <section>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
                / Hidden connections - {result.sharedDirectorsCount + result.sharedAddressesCount} shared
              </div>
              {result.sharedDirectorsCount + result.sharedAddressesCount === 0 ? (
                <div className="border border-white/5 bg-ink-850 px-5 py-6 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-signal-clean" />
                  <span className="text-sm text-ink-300">No shared directors or addresses found between these companies.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="border border-white/5 bg-ink-850 p-5">
                    <div className="text-2xl font-medium text-ink-50 tabular-nums">{result.sharedDirectorsCount}</div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono mb-3">Shared directors</div>
                    {result.sharedDirectors.length > 0 ? (
                      <ul className="space-y-1.5">
                        {result.sharedDirectors.map((d, i) => (
                          <li key={i} className="flex items-center gap-2">
                            <Avatar name={d.label} type="person" size={20} />
                            <span className="text-xs text-ink-300">{d.label}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[10px] font-mono text-ink-600">none</div>
                    )}
                  </div>
                  <div className="border border-white/5 bg-ink-850 p-5">
                    <div className="text-2xl font-medium text-ink-50 tabular-nums">{result.sharedAddressesCount}</div>
                    <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono mb-3">Shared addresses</div>
                    {result.sharedAddresses.length > 0 ? (
                      <ul className="space-y-1.5">
                        {result.sharedAddresses.map((a, i) => (
                          <li key={i} className="text-xs text-ink-300 truncate">{a.label}</li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[10px] font-mono text-ink-600">none</div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Links */}
            <div className="flex gap-4">
              <Link href={`/investigate/${result.a.id}/overview`} className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors">
                View {result.a.companyName} report
              </Link>
              <Link href={`/investigate/${result.b.id}/overview`} className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors">
                View {result.b.companyName} report
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function ScoreCard({ data, worse }: { data: CompanySummary; worse: boolean }) {
  const sc = (s: number) => s >= 75 ? 'text-signal-critical' : s >= 50 ? 'text-signal-high' : s >= 25 ? 'text-signal-medium' : 'text-signal-clean';
  return (
    <div className={`border bg-ink-850 p-6 ${worse ? 'border-signal-critical/30' : 'border-white/5'}`}>
      <div className="flex items-center gap-3 mb-4">
        <Avatar name={data.companyName} type="company" size={32} />
        <div className="min-w-0">
          <div className="text-sm text-ink-50 font-medium truncate">{data.companyName}</div>
          <div className="text-[10px] font-mono text-ink-500">{data.query}</div>
        </div>
      </div>
      <div className={`text-4xl font-medium tabular-nums ${sc(data.riskScore || 0)}`}>{data.riskScore ?? '-'}</div>
      <div className="text-[10px] font-mono text-ink-500 mt-1">{data.findingsCount} findings - {data.counts?.companies || 0} companies</div>
    </div>
  );
}

function CompareRow({ label, a, b, betterFn, worseFn }: {
  label: string; a: string; b: string;
  betterFn?: (val: string, other: string) => boolean;
  worseFn?: (val: string) => boolean;
}) {
  const colorA = worseFn?.(a) ? 'text-signal-critical' : betterFn?.(a, b) ? 'text-signal-clean' : 'text-ink-50';
  const colorB = worseFn?.(b) ? 'text-signal-critical' : betterFn?.(b, a) ? 'text-signal-clean' : 'text-ink-50';
  return (
    <div className="grid grid-cols-3 border-b border-white/5 last:border-b-0">
      <div className="px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-ink-500 flex items-center">{label}</div>
      <div className={`px-5 py-3 text-sm font-medium ${colorA} border-l border-white/5`}>{a}</div>
      <div className={`px-5 py-3 text-sm font-medium ${colorB} border-l border-white/5`}>{b}</div>
    </div>
  );
}
