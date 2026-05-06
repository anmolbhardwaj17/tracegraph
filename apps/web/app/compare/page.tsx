'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, X, ArrowRight } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const VERDICT_CONFIG = {
  PROCEED:    { label: 'Proceed',           color: 'text-signal-clean',    border: 'border-signal-clean/30',    bg: 'bg-signal-clean/8',    dot: 'bg-signal-clean' },
  CAUTION:    { label: 'Proceed w/ caution',color: 'text-signal-medium',   border: 'border-signal-medium/30',   bg: 'bg-signal-medium/8',   dot: 'bg-signal-medium' },
  CONDITIONS: { label: 'Conditions required',color:'text-signal-high',     border: 'border-signal-high/30',     bg: 'bg-signal-high/8',     dot: 'bg-signal-high' },
  WALK:       { label: 'Do not proceed',    color: 'text-signal-critical', border: 'border-signal-critical/30', bg: 'bg-signal-critical/8', dot: 'bg-signal-critical' },
};

const READINESS_LABEL = (s: number) => s >= 70 ? 'Strong target' : s >= 50 ? 'Viable target' : s >= 30 ? 'Caution advised' : 'Not recommended';
const READINESS_COLOR = (s: number) => s >= 70 ? 'text-signal-clean' : s >= 50 ? 'text-signal-medium' : s >= 30 ? 'text-signal-high' : 'text-signal-critical';
const RISK_COLOR = (s: number) => s >= 75 ? 'text-signal-critical' : s >= 50 ? 'text-signal-high' : s >= 25 ? 'text-signal-medium' : 'text-signal-clean';

export default function ComparePage() {
  const [investigations, setInvestigations] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>(['', '']);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [sectorData, setSectorData] = useState<any[]>([]);

  useEffect(() => {
    fetch(`${API}/api/investigations?limit=100`)
      .then(r => r.json())
      .then(d => {
        const items = Array.isArray(d) ? d : d.items || [];
        setInvestigations(items.filter((i: any) => i.status === 'COMPLETE'));
      })
      .catch(() => {});
    fetch(`${API}/api/investigations/benchmarks/sectors`)
      .then(r => r.json())
      .then(setSectorData)
      .catch(() => {});
  }, []);

  function setSlot(idx: number, val: string) {
    setSelected(prev => prev.map((s, i) => i === idx ? val : s));
  }

  function addSlot() {
    if (selected.length < 3) setSelected(prev => [...prev, '']);
  }

  function removeSlot(idx: number) {
    if (selected.length <= 2) return;
    setSelected(prev => prev.filter((_, i) => i !== idx));
    setResult(null);
  }

  async function compare() {
    const ids = selected.filter(Boolean);
    if (ids.length < 2) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/investigations/compare?ids=${ids.join(',')}`);
      setResult(await res.json());
    } catch {}
    setLoading(false);
  }

  const companies: any[] = result?.companies || [];
  const canCompare = selected.filter(Boolean).length >= 2 && new Set(selected.filter(Boolean)).size === selected.filter(Boolean).length;

  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium text-ink-50">Target Comparison</h1>
            <p className="text-xs font-mono text-ink-500 mt-1">Side-by-side acquisition due diligence</p>
          </div>
          {companies.length > 0 && (
            <div className="text-[10px] font-mono text-ink-600">
              Sorted by acquisition readiness
            </div>
          )}
        </div>

        {/* Selection grid */}
        <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${selected.length}, 1fr)` }}>
          {selected.map((val, idx) => (
            <div key={idx} className="relative">
              <label className="text-[9px] font-mono uppercase tracking-[0.2em] text-ink-600 mb-1.5 block">
                / Target {String.fromCharCode(65 + idx)}
              </label>
              <select
                value={val}
                onChange={e => setSlot(idx, e.target.value)}
                className="w-full bg-ink-850 border border-white/10 text-xs text-ink-100 px-3 py-2.5 focus:outline-none focus:border-white/30 appearance-none cursor-pointer"
              >
                <option value="" className="bg-ink-900">Select investigation...</option>
                {investigations
                  .filter(inv => !selected.includes(inv.id) || inv.id === val)
                  .map(inv => (
                    <option key={inv.id} value={inv.id} className="bg-ink-900">
                      {inv.companyName || inv.query} (Risk: {inv.riskScore ?? '—'})
                    </option>
                  ))}
              </select>
              {idx >= 2 && (
                <button
                  onClick={() => removeSlot(idx)}
                  className="absolute right-8 top-7 text-ink-600 hover:text-ink-400 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mb-10">
          <button
            onClick={compare}
            disabled={!canCompare || loading}
            className="px-6 py-2.5 bg-ink-50 text-ink-900 text-xs font-medium hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? 'Comparing...' : 'Compare targets'}
          </button>
          {selected.length < 3 && (
            <button
              onClick={addSlot}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-ink-500 hover:text-ink-50 hover:border-white/30 transition-colors"
            >
              <Plus size={10} />
              Add third target
            </button>
          )}
        </div>

        {companies.length > 0 && (
          <div className="space-y-8">

            {/* Score cards */}
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${companies.length}, 1fr)` }}>
              {companies.map((c: any, i: number) => {
                const verdict = VERDICT_CONFIG[c.dealVerdict as keyof typeof VERDICT_CONFIG] || VERDICT_CONFIG.CAUTION;
                const isBest = i === 0; // sorted by readiness
                return (
                  <div key={c.investigationId} className={`border bg-ink-850 p-5 ${isBest ? 'border-[#d4ff00]/20' : 'border-white/5'}`}>
                    {isBest && (
                      <div className="text-[8px] font-mono uppercase tracking-wider text-[#d4ff00]/60 mb-3">Best target</div>
                    )}
                    <div className="flex items-center gap-3 mb-4">
                      <Avatar name={c.companyName} type="company" size={28} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-ink-50 truncate">{c.companyName}</div>
                        <div className="text-[9px] font-mono text-ink-600 uppercase">{c.jurisdiction} · {c.tier}</div>
                      </div>
                    </div>

                    {/* Dual score display */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-1">Acq. Readiness</div>
                        <div className={`text-2xl font-medium tabular-nums ${READINESS_COLOR(c.acquisitionReadiness ?? 0)}`}>
                          {c.acquisitionReadiness ?? '—'}
                        </div>
                        <div className={`text-[9px] font-mono mt-0.5 ${READINESS_COLOR(c.acquisitionReadiness ?? 0)}`}>
                          {READINESS_LABEL(c.acquisitionReadiness ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-1">Deal Risk</div>
                        <div className={`text-2xl font-medium tabular-nums ${RISK_COLOR(c.riskScore)}`}>
                          {c.riskScore}
                        </div>
                        <div className={`text-[9px] font-mono mt-0.5 ${RISK_COLOR(c.riskScore)}`}>
                          {c.riskClassification}
                        </div>
                      </div>
                    </div>

                    {/* Deal verdict */}
                    <div className={`flex items-center gap-2 px-3 py-2 border ${verdict.border} mb-4`} style={{ background: 'rgba(0,0,0,0.2)' }}>
                      <span className={`w-1.5 h-1.5 rounded-full ${verdict.dot}`} />
                      <span className={`text-[9px] font-mono ${verdict.color}`}>{verdict.label}</span>
                    </div>

                    {/* Quick flags */}
                    <div className="flex flex-wrap gap-1">
                      {c.sanctionsMatches > 0 && <Flag label={`${c.sanctionsMatches} sanctions`} sev="critical" />}
                      {c.pepCount > 0 && <Flag label={`${c.pepCount} PEP`} sev="high" />}
                      {c.criticalFindings > 0 && <Flag label={`${c.criticalFindings} critical`} sev="critical" />}
                      {c.fatfFlags > 0 && <Flag label={`${c.fatfFlags} FATF`} sev="high" />}
                      {c.courtCases > 0 && <Flag label={`${c.courtCases} courts`} sev="medium" />}
                      {c.sanctionsMatches === 0 && c.pepCount === 0 && c.criticalFindings === 0 && (
                        <Flag label="Clean screen" sev="clean" />
                      )}
                    </div>

                    <Link
                      href={`/investigate/${c.investigationId}/overview`}
                      className="mt-4 flex items-center gap-1 text-[9px] font-mono text-ink-600 hover:text-ink-400 transition-colors"
                    >
                      Full report <ArrowRight size={9} />
                    </Link>
                  </div>
                );
              })}
            </div>

            {/* Summary strip */}
            {result.summary && (
              <div className="border border-white/5 bg-ink-850 px-6 py-4">
                <div className="flex items-center gap-8 flex-wrap">
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">Summary</span>
                  <SumStat label="Best readiness" value={result.summary.bestTarget?.name ?? '—'} sub={`${result.summary.bestTarget?.readiness ?? '—'}/100`} />
                  <SumStat label="Avg risk score" value={String(result.summary.averageRiskScore)} />
                  <SumStat label="Total PEPs" value={String(result.summary.totalPeps)} warn={result.summary.totalPeps > 0} />
                  <SumStat label="Sanctions" value={String(result.summary.totalSanctions)} warn={result.summary.totalSanctions > 0} critical={result.summary.totalSanctions > 0} />
                  <SumStat label="Court cases" value={String(result.summary.totalCourtCases)} />
                </div>
              </div>
            )}

            {/* Full comparison table */}
            <div className="border border-white/5">
              <div className="border-b border-white/5 bg-ink-900">
                <CmpHeader companies={companies} label="Metric" />
              </div>

              <CmpSection label="Acquisition" />
              <CmpRow label="Readiness score" companies={companies} get={c => `${c.acquisitionReadiness ?? '—'}/100`}
                colorFn={c => c.acquisitionReadiness >= 70 ? 'signal-clean' : c.acquisitionReadiness >= 50 ? 'normal' : 'signal-high'} isBest />
              <CmpRow label="Deal verdict" companies={companies} get={c => VERDICT_CONFIG[c.dealVerdict as keyof typeof VERDICT_CONFIG]?.label || c.dealVerdict}
                colorFn={c => c.dealVerdict === 'PROCEED' ? 'signal-clean' : c.dealVerdict === 'WALK' ? 'signal-critical' : 'normal'} />
              <CmpRow label="Ownership depth" companies={companies} get={c => c.uboChainDepth ? `${c.uboChainDepth} levels` : '—'}
                colorFn={c => c.uboChainDepth > 4 ? 'signal-high' : 'normal'} />

              <CmpSection label="Risk & Compliance" />
              <CmpRow label="Risk score" companies={companies} get={c => `${c.riskScore}/100`}
                colorFn={c => c.riskScore >= 50 ? 'signal-critical' : c.riskScore < 25 ? 'signal-clean' : 'normal'} />
              <CmpRow label="Critical findings" companies={companies} get={c => String(c.criticalFindings)}
                colorFn={c => c.criticalFindings > 0 ? 'signal-critical' : 'signal-clean'} />
              <CmpRow label="High findings" companies={companies} get={c => String(c.highFindings)}
                colorFn={c => c.highFindings > 2 ? 'signal-high' : 'normal'} />
              <CmpRow label="PEPs" companies={companies} get={c => String(c.pepCount)}
                colorFn={c => c.pepCount > 0 ? 'signal-high' : 'signal-clean'} />
              <CmpRow label="Sanctions" companies={companies} get={c => c.sanctionsMatches > 0 ? `${c.sanctionsMatches} match` : 'Clear'}
                colorFn={c => c.sanctionsMatches > 0 ? 'signal-critical' : 'signal-clean'} />
              <CmpRow label="FATF flags" companies={companies} get={c => String(c.fatfFlags)}
                colorFn={c => c.fatfFlags > 0 ? 'signal-high' : 'normal'} />
              <CmpRow label="Adverse media" companies={companies} get={c => String(c.adverseMediaCount)}
                colorFn={c => c.adverseMediaCount > 2 ? 'signal-high' : 'normal'} />
              <CmpRow label="Court cases" companies={companies} get={c => String(c.courtCases)}
                colorFn={c => c.courtCases > 5 ? 'signal-high' : 'normal'} />

              <CmpSection label="Network" />
              <CmpRow label="Total entities" companies={companies} get={c => String(c.totalEntities)} />
              <CmpRow label="Connected companies" companies={companies} get={c => String(c.companies)} />
              <CmpRow label="Directors & officers" companies={companies} get={c => String(c.people)} />

              {companies.some((c: any) => c.financials) && (
                <>
                  <CmpSection label="Financials (where available)" />
                  <CmpRow label="Profit margin" companies={companies}
                    get={c => c.financials?.profitMargin != null ? `${c.financials.profitMargin}%` : '—'}
                    colorFn={c => c.financials?.profitMargin != null && c.financials.profitMargin < 0 ? 'signal-critical' : c.financials?.profitMargin > 10 ? 'signal-clean' : 'normal'} />
                  <CmpRow label="Debt / Equity" companies={companies}
                    get={c => c.financials?.debtToEquity != null ? String(c.financials.debtToEquity) : '—'}
                    colorFn={c => c.financials?.debtToEquity > 3 ? 'signal-high' : 'normal'} />
                  <CmpRow label="Current ratio" companies={companies}
                    get={c => c.financials?.currentRatio != null ? String(c.financials.currentRatio) : '—'}
                    colorFn={c => c.financials?.currentRatio != null && c.financials.currentRatio < 1 ? 'signal-critical' : 'normal'} />
                  <CmpRow label="Insider signal" companies={companies}
                    get={c => c.insiderSignal || '—'}
                    colorFn={c => c.insiderSignal === 'NET_SELLING' ? 'signal-high' : 'normal'} />
                </>
              )}

              {companies.some((c: any) => c.profile?.revenue || c.profile?.employees) && (
                <>
                  <CmpSection label="Profile" />
                  <CmpRow label="Revenue" companies={companies} get={c => c.profile?.revenue || '—'} />
                  <CmpRow label="Employees" companies={companies} get={c => c.profile?.employees || '—'} />
                  <CmpRow label="Industry" companies={companies} get={c => c.profile?.industry || '—'} />
                </>
              )}
            </div>

            {/* Sector benchmarks context */}
            {sectorData.length > 0 && (
              <div className="border border-white/5 bg-ink-850 p-6">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Sector benchmarks</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {sectorData.slice(0, 8).map((s: any) => (
                    <div key={s.sector} className="border border-white/5 p-3">
                      <div className="text-[9px] font-mono text-ink-600 mb-1 truncate">{s.sector}</div>
                      <div className="text-xs font-medium text-ink-200">Risk avg: <span className={RISK_COLOR(s.avgRiskScore)}>{s.avgRiskScore}</span></div>
                      <div className="text-[9px] font-mono text-ink-500">{s.count} investigated</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </main>
  );
}

function Flag({ label, sev }: { label: string; sev: 'critical' | 'high' | 'medium' | 'clean' }) {
  const cls = {
    critical: 'bg-signal-critical/15 text-signal-critical border-signal-critical/30',
    high:     'bg-signal-high/15 text-signal-high border-signal-high/30',
    medium:   'bg-signal-medium/15 text-signal-medium border-signal-medium/30',
    clean:    'bg-signal-clean/10 text-signal-clean border-signal-clean/20',
  }[sev];
  return <span className={`text-[7px] font-mono uppercase tracking-wider px-1.5 py-0.5 border rounded-sm ${cls}`}>{label}</span>;
}

function SumStat({ label, value, sub, warn, critical }: { label: string; value: string; sub?: string; warn?: boolean; critical?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-ink-500">{label}</span>
      <span className={`text-sm font-medium ${critical ? 'text-signal-critical' : warn ? 'text-signal-high' : 'text-ink-100'}`}>{value}</span>
      {sub && <span className="text-[9px] font-mono text-ink-600">{sub}</span>}
    </div>
  );
}

function CmpHeader({ companies, label }: { companies: any[]; label: string }) {
  return (
    <div className="grid border-b border-white/5" style={{ gridTemplateColumns: `180px repeat(${companies.length}, 1fr)` }}>
      <div className="px-5 py-3 text-[9px] font-mono uppercase tracking-wider text-ink-600">{label}</div>
      {companies.map((c: any) => (
        <div key={c.investigationId} className="px-5 py-3 border-l border-white/5 text-[10px] font-medium text-ink-300 truncate">{c.companyName}</div>
      ))}
    </div>
  );
}

function CmpSection({ label }: { label: string }) {
  return (
    <div className="px-5 py-2 bg-white/[0.015] border-b border-white/5">
      <span className="text-[9px] font-mono uppercase tracking-wider text-ink-600">{label}</span>
    </div>
  );
}

function CmpRow({ label, companies, get, colorFn, isBest }: {
  label: string;
  companies: any[];
  get: (c: any) => string;
  colorFn?: (c: any) => string;
  isBest?: boolean;
}) {
  const values = companies.map(get);
  return (
    <div className="grid border-b border-white/5 last:border-b-0" style={{ gridTemplateColumns: `180px repeat(${companies.length}, 1fr)` }}>
      <div className="px-5 py-3 text-[10px] font-mono uppercase tracking-wider text-ink-500 flex items-center">{label}</div>
      {companies.map((c: any, i: number) => {
        const color = colorFn ? colorFn(c) : 'normal';
        const cls = color === 'signal-clean' ? 'text-signal-clean' : color === 'signal-critical' ? 'text-signal-critical' : color === 'signal-high' ? 'text-signal-high' : color === 'signal-medium' ? 'text-signal-medium' : 'text-ink-100';
        const isBestVal = isBest && i === 0;
        return (
          <div key={c.investigationId} className={`px-5 py-3 border-l border-white/5 text-sm font-medium ${cls} ${isBestVal ? 'bg-[#d4ff00]/5' : ''}`}>
            {values[i]}
          </div>
        );
      })}
    </div>
  );
}
