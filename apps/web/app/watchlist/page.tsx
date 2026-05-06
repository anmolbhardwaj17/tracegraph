'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ArrowDownRight, Minus, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const FREQ_OPTIONS = [
  { value: 'DAILY',   label: 'Daily' },
  { value: 'WEEKLY',  label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'MANUAL',  label: 'Manual only' },
];

interface WatchlistItem {
  id: string;
  companyNumber: string;
  companyName: string;
  lastRiskScore: number | null;
  previousRiskScore: number | null;
  riskChange: string;
  lastInvestigationId: string | null;
  lastInvestigatedAt: string | null;
  checkFrequency?: string;
  createdAt: string;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reinvestigating, setReinvestigating] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/api/watchlist`)
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function remove(companyNumber: string) {
    await fetch(`${API}/api/watchlist/${companyNumber}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.companyNumber !== companyNumber));
  }

  async function setFrequency(companyNumber: string, frequency: string) {
    await fetch(`${API}/api/watchlist/${companyNumber}/frequency`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frequency }),
    });
    setItems(prev => prev.map(i => i.companyNumber === companyNumber ? { ...i, checkFrequency: frequency } : i));
  }

  async function checkNow(companyNumber: string) {
    setReinvestigating(prev => new Set([...prev, companyNumber]));
    try {
      await fetch(`${API}/api/watchlist/${companyNumber}/check-now`, { method: 'POST' });
      setItems(prev => prev.map(i => i.companyNumber === companyNumber ? { ...i, lastInvestigatedAt: new Date().toISOString() } : i));
    } catch {}
    setReinvestigating(prev => { const next = new Set(prev); next.delete(companyNumber); return next; });
  }

  async function reinvestigate(item: WatchlistItem) {
    setReinvestigating((prev) => new Set([...prev, item.companyNumber]));
    try {
      const res = await fetch(`${API}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: item.companyNumber, tier: 'STANDARD' }),
      });
      const data = await res.json();
      if (data?.id) {
        await fetch(`${API}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyNumber: item.companyNumber, companyName: item.companyName, investigationId: data.id }),
        });
        window.location.href = `/investigate/${data.id}`;
      }
    } catch { /* ignore */ }
    setReinvestigating((prev) => { const next = new Set(prev); next.delete(item.companyNumber); return next; });
  }

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium text-ink-50">Monitoring {items.length} compan{items.length === 1 ? 'y' : 'ies'}</h1>
            <p className="text-xs font-mono text-ink-500 mt-1">Automated checks run on your set schedule · alerts delivered by email</p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/alerts" className="text-xs font-mono text-ink-500 hover:text-ink-50 border border-white/10 px-3 py-1.5 transition-colors hover:border-white/30">
              View alerts →
            </Link>
            <Link href="/" className="text-xs font-mono text-ink-500 hover:text-ink-50 transition-colors">
              + add company
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-white/5 border border-white/5" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-white/10">
            <div className="text-ink-500 text-sm mb-2">No companies monitored yet.</div>
            <div className="text-ink-600 text-xs font-mono">Investigate a company and click "Watch" to start monitoring.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const delta = item.previousRiskScore != null && item.lastRiskScore != null
                ? item.lastRiskScore - item.previousRiskScore : null;
              return (
                <div key={item.id} className="border border-white/5 bg-ink-850 hover:border-white/10 transition-colors">
                  <div className="px-5 py-4 flex items-center gap-5">
                    <Avatar name={item.companyName} type="company" size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-50 font-medium truncate">{item.companyName}</span>
                        <span className="text-[10px] font-mono text-ink-600">{item.companyNumber}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] font-mono text-ink-500">
                          {item.lastInvestigatedAt
                            ? `Last checked ${new Date(item.lastInvestigatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                            : 'Not yet checked'}
                        </span>
                        {/* Frequency selector */}
                        <select
                          value={item.checkFrequency || 'WEEKLY'}
                          onChange={e => setFrequency(item.companyNumber, e.target.value)}
                          className="text-[9px] font-mono text-ink-600 bg-transparent border border-white/5 px-1.5 py-0.5 focus:outline-none hover:border-white/20 transition-colors cursor-pointer"
                        >
                          {FREQ_OPTIONS.map(o => (
                            <option key={o.value} value={o.value} className="bg-ink-900">{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Risk score + trend */}
                    <div className="flex items-center gap-3 shrink-0">
                      {item.lastRiskScore != null ? (
                        <div className="flex items-center gap-2">
                          <span className={`text-xl font-medium tabular-nums ${
                            item.lastRiskScore >= 75 ? 'text-signal-critical' :
                            item.lastRiskScore >= 50 ? 'text-signal-high' :
                            item.lastRiskScore >= 25 ? 'text-signal-medium' :
                            'text-signal-clean'
                          }`}>{item.lastRiskScore}</span>
                          {delta != null && delta !== 0 && (
                            <div className={`flex items-center gap-0.5 ${delta > 0 ? 'text-signal-critical' : 'text-signal-clean'}`}>
                              {delta > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                              <span className="text-[10px] font-mono">{delta > 0 ? '+' : ''}{delta}</span>
                            </div>
                          )}
                          {(delta === null || delta === 0) && item.riskChange === 'STABLE' && (
                            <Minus size={12} className="text-ink-600" />
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-ink-600">no score</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {item.lastInvestigationId && (
                        <Link
                          href={`/investigate/${item.lastInvestigationId}/overview`}
                          className="px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
                        >
                          View
                        </Link>
                      )}
                      <button
                        onClick={() => checkNow(item.companyNumber)}
                        disabled={reinvestigating.has(item.companyNumber)}
                        className="px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors disabled:text-ink-700 disabled:border-white/5 flex items-center gap-1.5"
                        title="Run a quick check now"
                      >
                        <RefreshCw size={10} className={reinvestigating.has(item.companyNumber) ? 'animate-spin' : ''} />
                        {reinvestigating.has(item.companyNumber) ? 'Checking' : 'Check now'}
                      </button>
                      <button
                        onClick={() => remove(item.companyNumber)}
                        className="p-1.5 text-ink-600 hover:text-signal-critical transition-colors"
                        title="Remove from watchlist"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
