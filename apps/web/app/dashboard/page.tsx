'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Trash2, ExternalLink, TrendingUp, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { Dropdown } from '../../components/Dropdown';
import { ThemeToggle } from '../../components/ThemeToggle';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RecentInvestigation {
  id: string;
  query: string;
  companyName?: string;
  status: string;
  createdAt: string;
  riskScore?: number;
  counts?: { entities: number; edges: number };
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
    if (!confirm('Delete this investigation? This cannot be undone.')) return;
    try {
      await fetch(`${API}/api/investigations/${id}`, { method: 'DELETE' });
      setRecent((prev) => prev.filter((i) => i.id !== id));
      setRecentTotal((t) => Math.max(0, t - 1));
    } catch {}
  }

  // Compute quick stats from loaded data
  const completed = recent.filter((i) => i.status === 'COMPLETE').length;
  const inProgress = recent.filter((i) => i.status !== 'COMPLETE' && i.status !== 'FAILED').length;
  const highRisk = recent.filter((i) => (i.riskScore || 0) >= 50).length;

  // Highest risk company
  const riskiest = [...recent].filter((i) => i.riskScore != null).sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0];

  return (
    <main className="min-h-screen bg-ink-900 text-ink-50">
      <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
            <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-ink-300">
            <Link href="/dashboard" className="text-ink-50">Dashboard</Link>
            <Link href="/compare" className="hover:text-ink-50 transition-colors">Compare</Link>
            <Link href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</Link>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-10">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <h1 className="text-2xl font-medium">Dashboard</h1>
            <p className="text-sm text-ink-500 mt-1 font-mono">{recentTotal} investigation{recentTotal === 1 ? '' : 's'}</p>
          </div>
          <Link href="/" className="px-4 py-2 bg-ink-50 text-ink-900 rounded-sm text-xs font-medium hover:bg-white transition-colors">
            + New investigation
          </Link>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border border-white/5 mb-8">
          <div className="bg-ink-850 p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={14} className="text-signal-clean" />
              <span className="text-[9px] uppercase tracking-[0.15em] text-ink-500 font-mono">Completed</span>
            </div>
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{invStats?.completed || completed}</div>
          </div>
          <div className="bg-ink-850 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 size={14} className={`text-signal-medium ${inProgress > 0 ? 'animate-spin' : ''}`} />
              <span className="text-[9px] uppercase tracking-[0.15em] text-ink-500 font-mono">In progress</span>
            </div>
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{inProgress}</div>
          </div>
          <div className="bg-ink-850 p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-ink-400" />
              <span className="text-[9px] uppercase tracking-[0.15em] text-ink-500 font-mono">Avg risk score</span>
            </div>
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{invStats?.avgScore ?? '-'}</div>
          </div>
          <div className="bg-ink-850 p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-signal-critical" />
              <span className="text-[9px] uppercase tracking-[0.15em] text-ink-500 font-mono">Highest risk</span>
            </div>
            {riskiest ? (
              <div>
                <div className="text-sm text-ink-50 truncate">{riskiest.companyName || riskiest.query}</div>
                <div className={`text-lg font-medium tabular-nums ${(riskiest.riskScore || 0) >= 50 ? 'text-signal-critical' : 'text-signal-medium'}`}>{riskiest.riskScore}</div>
              </div>
            ) : (
              <div className="text-2xl font-medium text-ink-50">-</div>
            )}
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <input
            type="text"
            placeholder="Search company name..."
            value={recentSearch}
            onChange={(e) => { setRecentSearch(e.target.value); setRecentPage(1); }}
            className="flex-1 min-w-[200px] px-4 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30"
          />
          <Dropdown
            value={recentRisk}
            onChange={(v) => { setRecentRisk(v); setRecentPage(1); }}
            options={[
              { value: '', label: 'All risk' },
              { value: 'CRITICAL', label: 'Critical (75+)' },
              { value: 'HIGH', label: 'High (50-74)' },
              { value: 'MEDIUM', label: 'Medium (25-49)' },
              { value: 'LOW', label: 'Low (0-24)' },
            ]}
          />
          <Dropdown
            value={recentStatus}
            onChange={(v) => { setRecentStatus(v); setRecentPage(1); }}
            options={[
              { value: '', label: 'All status' },
              { value: 'COMPLETE', label: 'Complete' },
              { value: 'EXPANDING', label: 'In progress' },
              { value: 'FAILED', label: 'Failed' },
            ]}
          />
        </div>

        {/* Investigation list */}
        {recent.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/10">
            <div className="text-ink-500 text-sm mb-2">No investigations found.</div>
            <Link href="/" className="text-xs font-mono text-ink-400 hover:text-ink-50 transition-colors">Start your first investigation</Link>
          </div>
        ) : (
          <div className="border border-white/5">
            <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/5 bg-ink-900 text-[9px] font-mono uppercase tracking-wider text-ink-500 items-center">
              <div className="col-span-5">Company</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-1">Network</div>
              <div className="col-span-1 text-right">Risk</div>
              <div className="col-span-1 text-right"></div>
            </div>
            {recent.map((inv) => {
              const isRunning = inv.status !== 'COMPLETE' && inv.status !== 'FAILED';
              return (
                <div key={inv.id} className="grid grid-cols-12 gap-3 px-5 py-3.5 border-b border-white/5 last:border-b-0 items-center hover:bg-white/[0.02] transition-colors group">
                  <Link href={`/investigate/${inv.id}${inv.status === 'COMPLETE' ? '/overview' : ''}`} className="col-span-5 min-w-0 flex items-center gap-3">
                    <Avatar name={inv.companyName || inv.query} type="company" size={32} />
                    <div className="min-w-0">
                      <div className="text-sm text-ink-50 font-medium truncate">{inv.companyName || inv.query}</div>
                      <div className="text-[10px] font-mono text-ink-600">{inv.query}</div>
                    </div>
                  </Link>
                  <div className="col-span-2">
                    {inv.status === 'COMPLETE' ? (
                      <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm bg-signal-clean/10 text-signal-clean border border-signal-clean/20">Complete</span>
                    ) : inv.status === 'FAILED' ? (
                      <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm bg-signal-critical/10 text-signal-critical border border-signal-critical/20">Failed</span>
                    ) : (
                      <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm bg-signal-medium/10 text-signal-medium border border-signal-medium/20 flex items-center gap-1.5 w-fit">
                        <Loader2 size={10} className="animate-spin" />
                        {inv.status === 'EXPANDING' ? 'Expanding' : inv.status === 'RESOLVING' ? 'Screening' : inv.status === 'SCORING' ? 'Scoring' : 'Running'}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 text-[10px] text-ink-400 font-mono">{formatDate(inv.createdAt)}</div>
                  <div className="col-span-1 text-[10px] font-mono text-ink-500">
                    {inv.counts?.entities ? `${inv.counts.entities.toLocaleString()}` : '-'}
                  </div>
                  <div className="col-span-1 text-right">
                    {inv.riskScore != null ? <RiskPill score={inv.riskScore} /> : <span className="text-[10px] font-mono text-ink-600">-</span>}
                  </div>
                  <div className="col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {inv.status === 'COMPLETE' && (
                      <Link href={`/investigate/${inv.id}/overview`} className="p-1 text-ink-600 hover:text-ink-50 transition-colors" title="View report">
                        <ExternalLink size={13} />
                      </Link>
                    )}
                    <button onClick={() => handleDelete(inv.id)} className="p-1 text-ink-700 hover:text-signal-critical transition-colors" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {recentTotal > 15 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => setRecentPage((p) => Math.max(1, p - 1))} disabled={recentPage <= 1} className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors">prev</button>
            <span className="text-xs font-mono text-ink-500">page {recentPage} of {Math.ceil(recentTotal / 15)}</span>
            <button onClick={() => setRecentPage((p) => p + 1)} disabled={recentPage >= Math.ceil(recentTotal / 15)} className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors">next</button>
          </div>
        )}
      </div>
    </main>
  );
}

function RiskPill({ score }: { score: number }) {
  const color =
    score >= 75 ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
    score >= 50 ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
    score >= 25 ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
    'bg-signal-clean/15 text-signal-clean border-signal-clean/30';
  return <span className={`text-xs font-mono font-medium px-2 py-0.5 rounded-sm border tabular-nums ${color}`}>{score}</span>;
}
