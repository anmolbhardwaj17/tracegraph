'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Avatar } from '../../components/Avatar';
import { Dropdown } from '../../components/Dropdown';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RecentInvestigation {
  id: string;
  query: string;
  companyName?: string;
  status: string;
  createdAt: string;
  riskScore?: number;
}

export default function DashboardPage() {
  const [recent, setRecent] = useState<RecentInvestigation[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [recentSearch, setRecentSearch] = useState('');
  const [recentRisk, setRecentRisk] = useState('');
  const [recentStatus, setRecentStatus] = useState('');
  const [invStats, setInvStats] = useState<any>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(recentPage), limit: '15' });
    if (recentSearch) params.set('search', recentSearch);
    if (recentRisk) params.set('risk', recentRisk);
    if (recentStatus) params.set('status', recentStatus);
    fetch(`${API}/api/investigations?${params}`)
      .then((r) => (r.ok ? r.json() : { items: [], total: 0 }))
      .then((data) => {
        if (Array.isArray(data)) { setRecent(data); setRecentTotal(data.length); }
        else { setRecent(data.items || []); setRecentTotal(data.total || 0); }
      })
      .catch(() => {});
  }, [recentPage, recentSearch, recentRisk, recentStatus]);

  useEffect(() => {
    fetch(`${API}/api/investigations/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setInvStats(d))
      .catch(() => {});
  }, []);

  async function handleDelete(id: string) {
    const pwd = prompt('Enter password to delete:');
    if (pwd !== 'delete') { if (pwd !== null) alert('Incorrect password.'); return; }
    try {
      await fetch(`${API}/api/investigations/${id}`, { method: 'DELETE' });
      setRecent((prev) => prev.filter((i) => i.id !== id));
      setRecentTotal((t) => Math.max(0, t - 1));
    } catch {}
  }

  return (
    <main className="min-h-screen bg-ink-950 text-ink-50">
      <div className="max-w-6xl mx-auto px-8 py-16">
        <div className="flex items-baseline justify-between mb-10">
          <div>
            <h1 className="text-2xl font-medium">Dashboard</h1>
            <p className="text-sm text-ink-500 mt-1 font-mono">{recentTotal} investigation{recentTotal === 1 ? '' : 's'}</p>
          </div>
          <Link href="/" className="text-xs font-mono text-ink-500 hover:text-ink-50 transition-colors">
            ← back to search
          </Link>
        </div>

        {/* Stats strip */}
        {invStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border border-white/5 mb-8">
            <div className="bg-ink-850 p-5">
              <div className="text-2xl font-medium text-ink-50 tabular-nums">{invStats.total}</div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">total runs</div>
            </div>
            <div className="bg-ink-850 p-5">
              <div className="text-2xl font-medium text-ink-50 tabular-nums">{invStats.completed}</div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">completed</div>
            </div>
            <div className="bg-ink-850 p-5">
              <div className="text-2xl font-medium text-ink-50 tabular-nums">{invStats.avgScore}</div>
              <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">avg risk</div>
            </div>
            <div className="bg-ink-850 p-5">
              <div className="text-[10px] font-mono text-ink-500 mb-1">top findings</div>
              {(invStats.topFindings || []).slice(0, 3).map((f: any) => (
                <div key={f.type} className="text-[10px] font-mono text-ink-400 truncate">{f.type} ({f.count})</div>
              ))}
            </div>
          </div>
        )}

        {/* Search + filters */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <input
            type="text"
            placeholder="Search company name…"
            value={recentSearch}
            onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
            className="flex-1 min-w-[200px] px-4 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30"
          />
          <Dropdown
            value={recentRisk}
            onChange={(v) => { setRecentRisk(v); setRecentPage(1); }}
            options={[
              { value: '', label: 'All risk' },
              { value: 'CRITICAL', label: 'Critical' },
              { value: 'HIGH', label: 'High' },
              { value: 'MEDIUM', label: 'Medium' },
              { value: 'LOW', label: 'Low' },
            ]}
          />
          <Dropdown
            value={recentStatus}
            onChange={(v) => { setRecentStatus(v); setRecentPage(1); }}
            options={[
              { value: '', label: 'All status' },
              { value: 'COMPLETE', label: 'Complete' },
              { value: 'FETCHING', label: 'Fetching' },
              { value: 'EXPANDING', label: 'Expanding' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />
        </div>

        {/* Investigation list */}
        {recent.length === 0 ? (
          <div className="text-center py-16 text-ink-500 text-sm font-mono border border-dashed border-white/10">
            No investigations match.
          </div>
        ) : (
          <div className="border border-white/5">
            <div className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
              <div className="col-span-5">Company</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-2 text-right">Risk</div>
              <div className="col-span-1 text-right"></div>
            </div>
            {recent.map((inv) => (
              <div key={inv.id} className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-white/5 last:border-b-0 items-center hover:bg-white/[0.02] transition-colors">
                <a href={`/investigate/${inv.id}`} className="col-span-5 min-w-0 flex items-center gap-3">
                  <Avatar name={inv.companyName || inv.query} type="company" size={28} />
                  <div className="text-sm text-ink-50 truncate">{inv.companyName || inv.query}</div>
                </a>
                <div className="col-span-2 text-[10px] font-mono text-ink-500 uppercase tracking-wider">{inv.status}</div>
                <div className="col-span-2 text-[10px] text-ink-500 font-mono">{new Date(inv.createdAt).toLocaleDateString()}</div>
                <div className="col-span-2 text-right">
                  {inv.riskScore !== undefined && <RiskPill score={inv.riskScore} />}
                </div>
                <div className="col-span-1 text-right">
                  <button onClick={() => handleDelete(inv.id)} className="text-ink-700 hover:text-signal-critical transition-colors text-sm" title="Delete">×</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {recentTotal > 15 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => setRecentPage((p) => Math.max(1, p - 1))} disabled={recentPage <= 1} className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors">← prev</button>
            <span className="text-xs font-mono text-ink-500">page {recentPage} of {Math.ceil(recentTotal / 15)}</span>
            <button onClick={() => setRecentPage((p) => p + 1)} disabled={recentPage >= Math.ceil(recentTotal / 15)} className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors">next →</button>
          </div>
        )}
      </div>
    </main>
  );
}

function RiskPill({ score }: { score: number }) {
  const color =
    score >= 60 ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
    score >= 30 ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
    'bg-signal-clean/15 text-signal-clean border-signal-clean/30';
  return <span className={`text-xs font-mono px-2 py-1 rounded-sm border ${color}`}>{score}</span>;
}
