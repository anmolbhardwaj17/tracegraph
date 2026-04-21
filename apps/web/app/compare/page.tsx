'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Dropdown } from '../../components/Dropdown';
import { Avatar } from '../../components/Avatar';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function ComparePage() {
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [result, setResult] = useState<any>(null);
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
      const res = await fetch(`${API}/api/investigations/compare?ids=${selectedA},${selectedB}`);
      setResult(await res.json());
    } catch {}
    setLoading(false);
  }

  if (investigations.length === 0 && !loadingInvs) loadInvestigations();

  const companies = result?.companies || [];
  const a = companies[0];
  const b = companies[1];

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-medium text-ink-50 mb-1">Company Comparison</h1>
        <p className="text-sm text-ink-500 font-mono mb-8">Side-by-side risk analysis</p>

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

        {a && b && (
          <div className="space-y-6">
            {/* Score cards */}
            <div className="grid grid-cols-2 gap-6">
              <ScoreCard data={a} worse={a.riskScore > b.riskScore} />
              <ScoreCard data={b} worse={b.riskScore > a.riskScore} />
            </div>

            {/* Summary */}
            {result.summary && (
              <div className="border border-white/5 bg-ink-850 px-6 py-4">
                <div className="flex items-center gap-8 flex-wrap">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">Summary</div>
                  <Stat label="Avg score" value={result.summary.averageRiskScore} />
                  <Stat label="Total PEPs" value={result.summary.totalPeps} warn={result.summary.totalPeps > 0} />
                  <Stat label="Total sanctions" value={result.summary.totalSanctions} warn={result.summary.totalSanctions > 0} />
                  <Stat label="Total court cases" value={result.summary.totalCourtCases} />
                </div>
              </div>
            )}

            {/* Full comparison table */}
            <section className="border border-white/5">
              <div className="px-5 py-3 border-b border-white/5 bg-ink-900">
                <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Full comparison</span>
              </div>
              <CmpRow label="Risk score" a={`${a.riskScore}/100`} b={`${b.riskScore}/100`} worseFn={(v) => parseInt(v) >= 50} betterFn={(v) => parseInt(v) < 25} />
              <CmpRow label="Classification" a={a.riskClassification} b={b.riskClassification} worseFn={(v) => v === 'CRITICAL' || v === 'HIGH'} betterFn={(v) => v === 'LOW'} />
              <CmpRow label="Total findings" a={String(a.totalFindings)} b={String(b.totalFindings)} />
              <CmpRow label="Critical findings" a={String(a.criticalFindings)} b={String(b.criticalFindings)} worseFn={(v) => Number(v) > 0} />
              <CmpRow label="Network size" a={`${a.totalEntities} entities`} b={`${b.totalEntities} entities`} />
              <CmpRow label="Companies" a={String(a.companies)} b={String(b.companies)} />
              <CmpRow label="People" a={String(a.people)} b={String(b.people)} />
              <CmpRow label="PEPs" a={String(a.pepCount)} b={String(b.pepCount)} worseFn={(v) => Number(v) > 0} />
              <CmpRow label="Sanctions" a={String(a.sanctionsMatches)} b={String(b.sanctionsMatches)} worseFn={(v) => Number(v) > 0} />
              <CmpRow label="Adverse media" a={String(a.adverseMediaCount)} b={String(b.adverseMediaCount)} worseFn={(v) => Number(v) > 0} />
              <CmpRow label="Court cases" a={String(a.courtCases)} b={String(b.courtCases)} />
              <CmpRow label="FATF flags" a={String(a.fatfFlags)} b={String(b.fatfFlags)} worseFn={(v) => Number(v) > 0} />
              <CmpRow label="Website" a={a.websiteExists ? 'Verified' : a.websiteExists === false ? 'Not found' : '-'} b={b.websiteExists ? 'Verified' : b.websiteExists === false ? 'Not found' : '-'} worseFn={(v) => v === 'Not found'} betterFn={(v) => v === 'Verified'} />
              <CmpRow label="Domain age" a={a.domainAge != null ? `${a.domainAge}yr` : '-'} b={b.domainAge != null ? `${b.domainAge}yr` : '-'} />
              {(a.financials || b.financials) && (
                <>
                  <CmpRow label="Profit margin" a={a.financials?.profitMargin != null ? `${a.financials.profitMargin}%` : '-'} b={b.financials?.profitMargin != null ? `${b.financials.profitMargin}%` : '-'} worseFn={(v) => v !== '-' && parseFloat(v) < 0} />
                  <CmpRow label="Debt/Equity" a={a.financials?.debtToEquity != null ? String(a.financials.debtToEquity) : '-'} b={b.financials?.debtToEquity != null ? String(b.financials.debtToEquity) : '-'} worseFn={(v) => v !== '-' && parseFloat(v) > 3} />
                  <CmpRow label="Current ratio" a={a.financials?.currentRatio != null ? String(a.financials.currentRatio) : '-'} b={b.financials?.currentRatio != null ? String(b.financials.currentRatio) : '-'} worseFn={(v) => v !== '-' && parseFloat(v) < 1} />
                </>
              )}
              {(a.profile?.revenue || b.profile?.revenue) && (
                <CmpRow label="Revenue" a={a.profile?.revenue || '-'} b={b.profile?.revenue || '-'} />
              )}
              {(a.profile?.employees || b.profile?.employees) && (
                <CmpRow label="Employees" a={a.profile?.employees || '-'} b={b.profile?.employees || '-'} />
              )}
              <CmpRow label="Political donations" a={a.politicalDonations > 0 ? `$${a.politicalDonations.toLocaleString()}` : '-'} b={b.politicalDonations > 0 ? `$${b.politicalDonations.toLocaleString()}` : '-'} />
              <CmpRow label="Insider signal" a={a.insiderSignal || '-'} b={b.insiderSignal || '-'} worseFn={(v) => v === 'NET_SELLING'} />
            </section>

            {/* Links */}
            <div className="flex gap-4">
              <Link href={`/investigate/${a.investigationId}/overview`} className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors">
                View {a.companyName} report
              </Link>
              <Link href={`/investigate/${b.investigationId}/overview`} className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors">
                View {b.companyName} report
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function ScoreCard({ data, worse }: { data: any; worse: boolean }) {
  const sc = (s: number) => s >= 75 ? 'text-signal-critical' : s >= 50 ? 'text-signal-high' : s >= 25 ? 'text-signal-medium' : 'text-signal-clean';
  return (
    <div className={`border bg-ink-850 p-6 ${worse ? 'border-signal-critical/30' : 'border-white/5'}`}>
      <div className="flex items-center gap-3 mb-4">
        <Avatar name={data.companyName} type="company" size={32} />
        <div className="min-w-0">
          <div className="text-sm text-ink-50 font-medium truncate">{data.companyName}</div>
          <div className="text-[10px] font-mono text-ink-500">{data.jurisdiction?.toUpperCase()} - {data.tier}</div>
        </div>
      </div>
      <div className={`text-4xl font-medium tabular-nums ${sc(data.riskScore || 0)}`}>{data.riskScore ?? '-'}</div>
      <div className="text-[10px] font-mono text-ink-500 mt-1">
        {data.totalFindings} findings - {data.companies} companies - {data.people} people
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        {data.pepCount > 0 && <Badge label={`${data.pepCount} PEP`} color="high" />}
        {data.sanctionsMatches > 0 && <Badge label="SANCTIONS" color="critical" />}
        {data.fatfFlags > 0 && <Badge label={`${data.fatfFlags} FATF`} color="high" />}
        {data.courtCases > 0 && <Badge label={`${data.courtCases} courts`} color="medium" />}
      </div>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: 'critical' | 'high' | 'medium' | 'low' }) {
  const colors = {
    critical: 'bg-signal-critical/15 text-signal-critical border-signal-critical/30',
    high: 'bg-signal-high/15 text-signal-high border-signal-high/30',
    medium: 'bg-signal-medium/15 text-signal-medium border-signal-medium/30',
    low: 'bg-white/5 text-ink-400 border-white/10',
  };
  return <span className={`text-[7px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${colors[color]}`}>{label}</span>;
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-ink-500">{label}</span>
      <span className={`text-sm font-medium ${warn ? 'text-signal-high' : 'text-ink-100'}`}>{value}</span>
    </div>
  );
}

function CmpRow({ label, a, b, betterFn, worseFn }: {
  label: string; a: string; b: string;
  betterFn?: (val: string) => boolean;
  worseFn?: (val: string) => boolean;
}) {
  const colorA = worseFn?.(a) ? 'text-signal-critical' : betterFn?.(a) ? 'text-signal-clean' : 'text-ink-50';
  const colorB = worseFn?.(b) ? 'text-signal-critical' : betterFn?.(b) ? 'text-signal-clean' : 'text-ink-50';
  return (
    <div className="grid grid-cols-3 border-b border-white/5 last:border-b-0">
      <div className="px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-ink-500 flex items-center">{label}</div>
      <div className={`px-5 py-3 text-sm font-medium ${colorA} border-l border-white/5`}>{a}</div>
      <div className={`px-5 py-3 text-sm font-medium ${colorB} border-l border-white/5`}>{b}</div>
    </div>
  );
}
