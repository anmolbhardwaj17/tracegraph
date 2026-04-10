'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar } from '../components/Avatar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RecentInvestigation {
  id: string;
  query: string;
  companyName?: string;
  status: string;
  createdAt: string;
  riskScore?: number;
}

interface SearchHit {
  companyNumber: string;
  title: string;
  status?: string;
  address?: string;
  incorporated?: string;
}

type Tier = 'QUICK' | 'STANDARD' | 'DEEP';

const COMPANY_NUMBER_RE = /^[A-Z0-9]{6,10}$/i;

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInvestigation[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [recentSearch, setRecentSearch] = useState('');
  const [recentRisk, setRecentRisk] = useState('');
  const [recentStatus, setRecentStatus] = useState('');
  const [invStats, setInvStats] = useState<any>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const debounceRef = useRef<any>(null);
  const router = useRouter();

  // Fetch paginated investigation history
  useEffect(() => {
    const params = new URLSearchParams({ page: String(recentPage), limit: '15' });
    if (recentSearch) params.set('search', recentSearch);
    if (recentRisk) params.set('risk', recentRisk);
    if (recentStatus) params.set('status', recentStatus);
    fetch(`${API}/api/investigations?${params}`)
      .then((r) => (r.ok ? r.json() : { items: [], total: 0 }))
      .then((data) => {
        // Support both old (array) and new (paginated) response shapes
        if (Array.isArray(data)) { setRecent(data); setRecentTotal(data.length); }
        else { setRecent(data.items || []); setRecentTotal(data.total || 0); }
      })
      .catch(() => {});
  }, [recentPage, recentSearch, recentRisk, recentStatus]);

  // Fetch stats once
  useEffect(() => {
    fetch(`${API}/api/investigations/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setInvStats(d))
      .catch(() => {});
  }, []);

  // Debounced live search for non-numeric queries
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed || COMPANY_NUMBER_RE.test(trimmed) || trimmed.length < 2) {
      setHits([]);
      setShowDropdown(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/api/companies-house/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setHits(data.items || []);
        setShowDropdown(true);
        setActiveIdx(-1);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function pickCompany(hit: SearchHit) {
    setSelectedHit(hit);
    setShowDropdown(false);
    setQuery(hit.title);
  }

  async function startInvestigation(q: string, tier: Tier = 'STANDARD') {
    setLoading(true);
    setError(null);
    setShowDropdown(false);
    try {
      const res = await fetch(`${API}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, tier }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      router.push(`/investigate/${data.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (activeIdx >= 0 && hits[activeIdx]) {
      pickCompany(hits[activeIdx]);
      return;
    }
    if (COMPANY_NUMBER_RE.test(trimmed)) {
      // Direct number → fabricate a hit so the tier picker still appears
      setSelectedHit({ companyNumber: trimmed, title: trimmed });
      setShowDropdown(false);
      return;
    }
    if (hits[0]) {
      pickCompany(hits[0]);
      return;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  return (
    <main className="relative min-h-screen">
      {/* Top nav */}
      <header className="fixed top-0 inset-x-0 z-20 backdrop-blur-md bg-ink-900/60 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3 reveal">
            <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
            <span className="text-sm tracking-tight">TraceGraph</span>
          </div>
          <nav className="flex items-center gap-8 text-sm text-ink-300 reveal reveal-delay-1">
            <a href="#approach" className="hover:text-ink-50 transition-colors">Approach</a>
            <span className="text-ink-600">|</span>
            <a href="#sources" className="hover:text-ink-50 transition-colors">Sources</a>
            <span className="text-ink-600">|</span>
            <a href="#recent" className="hover:text-ink-50 transition-colors">Recent</a>
            <span className="text-ink-600">|</span>
            <a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a>
            <span className="text-ink-600">|</span>
            <a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-48 pb-32 px-8 max-w-6xl mx-auto">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-8 reveal">
          / 001 · Corporate intelligence engine
        </div>

        <h1 className="text-[clamp(2.25rem,5vw,4.5rem)] leading-[1] tracking-tight font-medium text-ink-50 reveal reveal-delay-1">
          Know who&rsquo;s really
          <br />
          <span className="text-ink-400">behind it.</span>
        </h1>

        <p className="mt-10 text-lg text-ink-300 max-w-xl leading-relaxed reveal reveal-delay-2">
          TraceGraph autonomously investigates UK companies across public data sources,
          walks ownership and director networks, and produces a complete risk report:
          shell patterns, sanctions exposure, and structural anomalies.
        </p>

        {/* Search */}
        <form onSubmit={submit} className="mt-12 max-w-2xl reveal reveal-delay-3 relative">
          <div className="relative group">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => hits.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Enter a UK company name or number..."
              autoComplete="off"
              className="w-full px-6 py-5 pr-40 text-lg rounded-sm bg-ink-850 border border-white/10 text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-3 bg-ink-50 text-ink-900 rounded-sm font-medium text-sm hover:bg-white disabled:opacity-50 transition-all"
            >
              {loading ? 'Starting…' : 'Investigate →'}
            </button>

            {/* Dropdown */}
            {showDropdown && (searching || hits.length > 0) && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-ink-850 border border-white/10 rounded-sm shadow-2xl z-30 overflow-hidden">
                {searching && hits.length === 0 && (
                  <div className="px-5 py-4 text-xs font-mono text-ink-500">searching companies house…</div>
                )}
                {hits.map((h, i) => (
                  <button
                    key={h.companyNumber}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickCompany(h); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full text-left px-5 py-3 flex items-center justify-between gap-4 border-b border-white/5 last:border-b-0 transition-colors ${
                      activeIdx === i ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink-50 truncate">{h.title}</div>
                      <div className="text-[10px] text-ink-500 font-mono mt-0.5 truncate">
                        {h.companyNumber}
                        {h.address && ` · ${h.address}`}
                      </div>
                    </div>
                    {h.status && (
                      <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border shrink-0 ${
                        h.status === 'active'
                          ? 'bg-signal-clean/10 text-signal-clean border-signal-clean/30'
                          : 'bg-white/5 text-ink-400 border-white/10'
                      }`}>
                        {h.status}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {error && <p className="text-signal-critical text-sm mt-3">{error}</p>}
          {!selectedHit && (
            <p className="text-xs text-ink-500 mt-3 font-mono">
              Try → Tesco PLC  ·  00445790  ·  type to search
            </p>
          )}
        </form>

        {/* Tier picker */}
        {selectedHit && (
          <div className="mt-10 reveal max-w-4xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Selected company</div>
                <div className="mt-1 text-xl font-medium text-ink-50">{selectedHit.title}</div>
                <div className="text-xs font-mono text-ink-500 mt-0.5">{selectedHit.companyNumber}{selectedHit.status ? ` · ${selectedHit.status}` : ''}</div>
              </div>
              <button
                onClick={() => { setSelectedHit(null); setQuery(''); }}
                className="text-xs font-mono text-ink-500 hover:text-ink-50 transition-colors"
              >
                ← change
              </button>
            </div>

            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Choose research depth</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
              <TierCard
                tier="QUICK"
                badge="FREE"
                title="Quick scan"
                eta="30s · 2 min"
                bullets={[
                  'Target + direct directors',
                  'Max 200 entities',
                  'Companies House only',
                  'Basic profile, no scoring',
                ]}
                onClick={() => startInvestigation(selectedHit.companyNumber, 'QUICK')}
                disabled={loading}
              />
              <TierCard
                tier="STANDARD"
                badge="DEFAULT"
                title="Standard"
                eta="2 · 10 min"
                recommended
                bullets={[
                  'Depth 2 with smart filtering',
                  'Max 1,000 entities',
                  'All sources matched',
                  'Full anomaly detection',
                ]}
                onClick={() => startInvestigation(selectedHit.companyNumber, 'STANDARD')}
                disabled={loading}
              />
              <TierCard
                tier="DEEP"
                badge="PREMIUM"
                title="Deep investigation"
                eta="10 · 45 min"
                premium
                bullets={[
                  'Depth 3, no filtering',
                  'Max 5,000 entities',
                  'Enhanced entity resolution',
                  'Extra detection signals',
                ]}
                onClick={() => startInvestigation(selectedHit.companyNumber, 'DEEP')}
                disabled={loading}
              />
            </div>
          </div>
        )}
      </section>

      {/* Approach · three numbered cards */}
      <section id="approach" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 002 · Approach
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <Approach
              n="001"
              title="Multi-source intelligence"
              body="UK Companies House, OpenSanctions, and ICIJ OffshoreLeaks unified into one ownership graph with cross-source entity resolution."
            />
            <Approach
              n="002"
              title="Recursive expansion"
              body="BFS through directors, PSCs, and addresses with cycle detection, dedup, and large-corp pruning. Watch the network grow live."
            />
            <Approach
              n="003"
              title="Risk detection"
              body="Shell-company scoring, virtual office clusters, circular ownership, sanctions proximity, and temporal anomalies · every signal explained with evidence."
            />
          </div>
        </div>
      </section>

      {/* Data sources */}
      <section id="sources" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 003 · Data sources
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <Source
              kind="LIVE API"
              title="UK Companies House"
              body="Company profiles, officers, PSC, filing history. Rate-limited at 600 requests per 5 minutes."
            />
            <Source
              kind="BULK JSON"
              title="OpenSanctions"
              body="Global sanctions, PEPs, criminal entities · FollowTheMoney schema, refreshed daily."
            />
            <Source
              kind="BULK CSV"
              title="ICIJ OffshoreLeaks"
              body="Panama Papers, Paradise Papers, Pandora Papers, Bahamas Leaks · public ICIJ database."
            />
          </div>
        </div>
      </section>

      {/* Investigation history */}
      <section id="recent" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="flex items-baseline justify-between mb-8">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400">
              / 004 · Investigation history
            </div>
            <span className="text-xs text-ink-500 font-mono">{recentTotal} total</span>
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
            <select
              value={recentRisk}
              onChange={(e) => { setRecentRisk(e.target.value); setRecentPage(1); }}
              className="px-3 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-xs text-ink-50 font-mono focus:outline-none focus:border-white/30"
            >
              <option value="">All risk</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
            <select
              value={recentStatus}
              onChange={(e) => { setRecentStatus(e.target.value); setRecentPage(1); }}
              className="px-3 py-2.5 bg-ink-850 border border-white/10 rounded-sm text-xs text-ink-50 font-mono focus:outline-none focus:border-white/30"
            >
              <option value="">All status</option>
              <option value="COMPLETE">Complete</option>
              <option value="FETCHING">Fetching</option>
              <option value="EXPANDING">Expanding</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {recent.length === 0 ? (
            <div className="text-ink-500 text-sm">No investigations match.</div>
          ) : (
            <ul className="border-t border-white/5">
              {recent.map((inv) => (
                <li key={inv.id} className="border-b border-white/5">
                  <a
                    href={`/investigate/${inv.id}`}
                    className="grid grid-cols-12 gap-4 px-2 py-4 hover:bg-white/[0.02] transition-colors group items-center"
                  >
                    <div className="col-span-6 min-w-0 flex items-center gap-3">
                      <Avatar name={inv.companyName || inv.query} type="company" size={32} />
                      <div className="text-base text-ink-50 truncate group-hover:translate-x-1 transition-transform">
                        {inv.companyName || inv.query}
                      </div>
                    </div>
                    <div className="col-span-3 text-xs font-mono text-ink-500 uppercase tracking-wider">
                      {inv.status}
                    </div>
                    <div className="col-span-2 text-xs text-ink-500 font-mono">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </div>
                    <div className="col-span-1 text-right">
                      {inv.riskScore !== undefined && <RiskPill score={inv.riskScore} />}
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination */}
          {recentTotal > 15 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                disabled={recentPage <= 1}
                className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors"
              >
                ← prev
              </button>
              <span className="text-xs font-mono text-ink-500">
                page {recentPage} of {Math.ceil(recentTotal / 15)}
              </span>
              <button
                onClick={() => setRecentPage((p) => p + 1)}
                disabled={recentPage >= Math.ceil(recentTotal / 15)}
                className="text-xs font-mono text-ink-400 hover:text-ink-50 disabled:text-ink-700 transition-colors"
              >
                next →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-12 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-ink-500 font-mono">
          <div>© 2026 TraceGraph. All rights reserved.</div>
          <div className="flex items-center gap-5">
            <a href="/privacy" className="hover:text-ink-50 transition-colors">Privacy</a>
            <span className="text-ink-700">·</span>
            <a href="/terms" className="hover:text-ink-50 transition-colors">Terms</a>
            <span className="text-ink-700">·</span>
            <a href="https://anmolbhardwaj.com" target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors">
              anmolbhardwaj.com →
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}

function TierCard({
  tier, badge, title, eta, bullets, onClick, disabled, recommended, premium,
}: {
  tier: Tier; badge: string; title: string; eta: string; bullets: string[];
  onClick: () => void; disabled?: boolean; recommended?: boolean; premium?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative text-left p-7 bg-ink-900 hover:bg-ink-850 transition-all group disabled:opacity-50 ${
        recommended ? 'ring-1 ring-inset ring-white/15' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-6">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">/{tier === 'QUICK' ? '001' : tier === 'STANDARD' ? '002' : '003'}</span>
        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
          premium
            ? 'bg-signal-medium/10 text-signal-medium border-signal-medium/30'
            : recommended
            ? 'bg-ink-50/10 text-ink-50 border-white/20'
            : 'bg-signal-clean/10 text-signal-clean border-signal-clean/30'
        }`}>
          {premium && <span className="mr-1">⊘</span>}
          {badge}
        </span>
      </div>
      <h3 className="text-xl font-medium tracking-tight text-ink-50 mb-1">{title}</h3>
      <div className="text-[10px] font-mono text-ink-500 mb-5">est. {eta}</div>
      <ul className="space-y-2">
        {bullets.map((b, i) => (
          <li key={i} className="text-xs text-ink-300 flex gap-2">
            <span className="text-ink-500">›</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 text-xs font-mono text-ink-400 group-hover:text-ink-50 transition-colors">
        Start →
      </div>
    </button>
  );
}

function Approach({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-10 hover:bg-ink-850 transition-colors group">
      <div className="text-xs font-mono text-ink-500 mb-6">{n}</div>
      <h3 className="text-2xl font-medium tracking-tight text-ink-50 mb-4">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Source({ kind, title, body }: { kind: string; title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-10 hover:bg-ink-850 transition-colors">
      <div className="text-[10px] font-mono text-ink-500 tracking-[0.15em] mb-6">{kind}</div>
      <h3 className="text-xl font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function RiskPill({ score }: { score: number }) {
  const color =
    score >= 60 ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
    score >= 30 ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
    'bg-signal-clean/15 text-signal-clean border-signal-clean/30';
  return (
    <span className={`text-xs font-mono px-2 py-1 rounded-sm border ${color}`}>{score}</span>
  );
}
