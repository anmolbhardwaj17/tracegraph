'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface WatchlistItem {
  id: string;
  companyNumber: string;
  companyName: string;
  lastRiskScore: number | null;
  lastInvestigationId: string | null;
  lastInvestigatedAt: string | null;
  createdAt: string;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [reinvestigating, setReinvestigating] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/api/watchlist`)
      .then((r) => r.json())
      .then((d) => setItems(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function remove(companyNumber: string) {
    await fetch(`${API}/api/watchlist/${companyNumber}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((i) => i.companyNumber !== companyNumber));
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
        // Update watchlist entry
        await fetch(`${API}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyNumber: item.companyNumber,
            companyName: item.companyName,
            investigationId: data.id,
          }),
        });
        window.location.href = `/investigate/${data.id}`;
      }
    } catch { /* ignore */ }
    setReinvestigating((prev) => {
      const next = new Set(prev);
      next.delete(item.companyNumber);
      return next;
    });
  }

  return (
    <main className="min-h-screen bg-ink-950 text-ink-50">
      <div className="max-w-5xl mx-auto px-8 py-16">
        <div className="flex items-baseline justify-between mb-10">
          <div>
            <h1 className="text-2xl font-medium">Watchlist</h1>
            <p className="text-sm text-ink-500 mt-1 font-mono">
              {items.length} compan{items.length === 1 ? 'y' : 'ies'} monitored
            </p>
          </div>
          <Link href="/" className="text-xs font-mono text-ink-500 hover:text-ink-50 transition-colors">
            ← back to search
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-24 text-ink-500 font-mono text-sm">loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-white/10 text-ink-500 font-mono text-sm">
            No companies on your watchlist yet. Investigate a company and click "Watch" to start monitoring.
          </div>
        ) : (
          <div className="border border-white/5">
            <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
              <div className="col-span-4">Company</div>
              <div className="col-span-2">Risk</div>
              <div className="col-span-2">Last checked</div>
              <div className="col-span-2">Added</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 items-center hover:bg-white/[0.02]">
                <div className="col-span-4">
                  <div className="text-sm text-ink-50 truncate">{item.companyName}</div>
                  <div className="text-[10px] font-mono text-ink-500">{item.companyNumber}</div>
                </div>
                <div className="col-span-2">
                  {item.lastRiskScore != null ? (
                    <span className={`text-sm font-medium tabular-nums ${
                      item.lastRiskScore >= 75 ? 'text-signal-critical' :
                      item.lastRiskScore >= 50 ? 'text-signal-high' :
                      item.lastRiskScore >= 25 ? 'text-signal-medium' :
                      'text-signal-clean'
                    }`}>
                      {item.lastRiskScore}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-ink-600">—</span>
                  )}
                </div>
                <div className="col-span-2 text-[10px] font-mono text-ink-500">
                  {item.lastInvestigatedAt
                    ? new Date(item.lastInvestigatedAt).toLocaleDateString()
                    : '—'}
                </div>
                <div className="col-span-2 text-[10px] font-mono text-ink-500">
                  {new Date(item.createdAt).toLocaleDateString()}
                </div>
                <div className="col-span-2 flex items-center justify-end gap-2">
                  {item.lastInvestigationId && (
                    <Link
                      href={`/investigate/${item.lastInvestigationId}`}
                      className="text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
                    >
                      view
                    </Link>
                  )}
                  <button
                    onClick={() => reinvestigate(item)}
                    disabled={reinvestigating.has(item.companyNumber)}
                    className="text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors disabled:text-ink-700"
                  >
                    {reinvestigating.has(item.companyNumber) ? 'starting…' : 're-investigate'}
                  </button>
                  <button
                    onClick={() => remove(item.companyNumber)}
                    className="text-[10px] font-mono text-ink-600 hover:text-signal-critical transition-colors"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
