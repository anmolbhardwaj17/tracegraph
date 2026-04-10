'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EncryptedText } from '../components/ui/encrypted-text';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

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
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const debounceRef = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // "/" keyboard shortcut to focus search
  useEffect(() => {
    function handleSlash(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleSlash);
    return () => window.removeEventListener('keydown', handleSlash);
  }, []);


  // Clear tier picker when search text is removed
  useEffect(() => {
    if (!query.trim() && selectedHit) {
      setSelectedHit(null);
    }
  }, [query]);

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
          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm text-ink-300 reveal reveal-delay-1">
            <a href="#approach" className="hover:text-ink-50 transition-colors">Approach</a>
            <a href="#sources" className="hover:text-ink-50 transition-colors">Sources</a>
            <a href="#capabilities" className="hover:text-ink-50 transition-colors">Capabilities</a>
            <span className="text-ink-700">|</span>
            <a href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</a>
            <a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a>
            <a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a>
          </nav>
          {/* Mobile hamburger */}
          <MobileMenu />
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-48 pb-32 px-8 max-w-6xl mx-auto">
        {/* Dot grid background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }}
        />

        <div className="relative">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-8 reveal">
            / 001 · Corporate intelligence engine
          </div>

          <h1 className="text-[clamp(2.25rem,5vw,4.5rem)] leading-[1] tracking-tight font-medium text-ink-50 reveal reveal-delay-1">
            Enter a company.
            <br />
            <span className="text-ink-400">
              <EncryptedText
                text="Uncover everything."
                revealDelayMs={60}
                flipDelayMs={40}
                className="text-ink-400"
                encryptedClassName="text-ink-600"
              />
            </span>
          </h1>

          <p className="mt-10 text-lg text-ink-300 max-w-xl leading-relaxed reveal reveal-delay-2">
            Trace ownership chains, detect shell networks, screen sanctions — from public data, in minutes.
          </p>

          <p className="mt-4 text-xs font-mono text-ink-500 reveal reveal-delay-2">
            Mapping 6M+ UK companies · 4.1M sanctions entities · 770K+ offshore records · 20+ risk signals
          </p>

        {/* Search */}
        <form onSubmit={submit} className="mt-12 max-w-2xl reveal reveal-delay-3 relative">
          <div className="relative group">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => hits.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder="Enter a UK company name or number..."
              autoComplete="off"
              className="w-full px-6 py-5 pr-48 text-lg rounded-sm bg-ink-850 border border-white/10 text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
            />
            {/* "/" shortcut hint */}
            <span className="absolute right-36 top-1/2 -translate-y-1/2 text-[10px] font-mono text-ink-600 border border-white/10 rounded-sm px-1.5 py-0.5 pointer-events-none">/</span>
            <button
              type="submit"
              disabled={loading}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-3 bg-ink-50 text-ink-900 rounded-sm font-medium text-sm hover:bg-white disabled:opacity-50 transition-all group/btn"
            >
              {loading ? 'Starting…' : <span>Investigate <span className="inline-block transition-transform group-hover/btn:translate-x-1">→</span></span>}
            </button>

            {/* Dropdown */}
            {showDropdown && (searching || hits.length > 0) && (
              <div className="absolute left-0 right-0 top-full mt-2 bg-ink-850 border border-white/10 rounded-sm shadow-2xl z-30 overflow-hidden">
                {searching && hits.length === 0 && (
                  <div className="px-5 py-4 text-xs font-mono text-ink-500 flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border border-ink-500 border-t-ink-50 rounded-full animate-spin" />
                    searching companies house…
                  </div>
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
        </div>
      </section>

      {/* Product showcase */}
      <section className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 002 · See it in action
          </div>

          {/* Mock investigation result card */}
          <div className="border border-white/5 bg-ink-900 overflow-hidden">
            {/* Mock header */}
            <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-sm bg-signal-medium/20 text-signal-medium flex items-center justify-center font-mono text-xs font-bold">P</div>
                <div>
                  <div className="text-base font-medium text-ink-50">PepsiCo International Limited</div>
                  <div className="text-[10px] font-mono text-ink-500 mt-0.5">01521219 · Investigation complete</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border bg-signal-medium/15 text-signal-medium border-signal-medium/30">42 MEDIUM</span>
              </div>
            </div>

            {/* Mock graph visualization */}
            <div className="px-8 py-8 border-b border-white/5 bg-ink-950/50 flex items-center justify-center" style={{ height: 320 }}>
              <svg viewBox="0 0 600 250" className="w-full max-w-2xl h-full" style={{ overflow: 'visible' }}>
                {/* Edges */}
                <g stroke="rgba(94,230,161,0.15)" strokeWidth="1">
                  <line x1="300" y1="125" x2="180" y2="60" /><line x1="300" y1="125" x2="420" y2="70" />
                  <line x1="300" y1="125" x2="200" y2="180" /><line x1="300" y1="125" x2="400" y2="190" />
                  <line x1="300" y1="125" x2="140" y2="130" /><line x1="300" y1="125" x2="460" y2="120" />
                  <line x1="180" y1="60" x2="100" y2="30" /><line x1="180" y1="60" x2="120" y2="90" />
                  <line x1="420" y1="70" x2="500" y2="40" /><line x1="420" y1="70" x2="480" y2="100" />
                  <line x1="200" y1="180" x2="130" y2="210" /><line x1="200" y1="180" x2="160" y2="230" />
                  <line x1="400" y1="190" x2="470" y2="220" /><line x1="400" y1="190" x2="450" y2="170" />
                  <line x1="140" y1="130" x2="80" y2="100" /><line x1="140" y1="130" x2="70" y2="160" />
                  <line x1="460" y1="120" x2="530" y2="90" /><line x1="460" y1="120" x2="540" y2="150" />
                  <line x1="100" y1="30" x2="50" y2="50" /><line x1="500" y1="40" x2="550" y2="25" />
                </g>
                <g stroke="rgba(245,197,24,0.2)" strokeWidth="1" strokeDasharray="3,3">
                  <line x1="180" y1="60" x2="200" y2="180" /><line x1="420" y1="70" x2="400" y2="190" />
                </g>
                {/* Nodes — animated with gentle drift */}
                <style>{`
                  @keyframes drift1 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(2px,-2px) } }
                  @keyframes drift2 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(-2px,3px) } }
                  @keyframes drift3 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(3px,1px) } }
                  .drift1 { animation: drift1 18s ease-in-out infinite }
                  .drift2 { animation: drift2 22s ease-in-out infinite }
                  .drift3 { animation: drift3 20s ease-in-out infinite }
                `}</style>
                {/* Root */}
                <circle cx="300" cy="125" r="10" fill="#FFFFFF" className="drift1" />
                {/* Companies (amber) */}
                <circle cx="180" cy="60" r="6" fill="#F5C518" className="drift2" />
                <circle cx="420" cy="70" r="7" fill="#F5C518" className="drift1" />
                <circle cx="100" cy="30" r="4" fill="#F5C518" className="drift3" />
                <circle cx="500" cy="40" r="5" fill="#F5C518" className="drift2" />
                <circle cx="130" cy="210" r="4" fill="#F5C518" className="drift1" />
                <circle cx="470" cy="220" r="4" fill="#F5C518" className="drift3" />
                {/* People (green) */}
                <circle cx="200" cy="180" r="5" fill="#5EE6A1" className="drift3" />
                <circle cx="400" cy="190" r="6" fill="#5EE6A1" className="drift1" />
                <circle cx="140" cy="130" r="5" fill="#5EE6A1" className="drift2" />
                <circle cx="460" cy="120" r="5" fill="#5EE6A1" className="drift3" />
                <circle cx="120" cy="90" r="4" fill="#5EE6A1" className="drift1" />
                <circle cx="480" cy="100" r="4" fill="#5EE6A1" className="drift2" />
                {/* Addresses (gray) */}
                <circle cx="80" cy="100" r="3" fill="#737373" className="drift2" />
                <circle cx="530" cy="90" r="3" fill="#737373" className="drift1" />
                <circle cx="70" cy="160" r="3" fill="#737373" className="drift3" />
                <circle cx="540" cy="150" r="3" fill="#737373" className="drift2" />
                <circle cx="160" cy="230" r="3" fill="#737373" className="drift1" />
                <circle cx="450" cy="170" r="3" fill="#737373" className="drift3" />
                {/* Outer leaves */}
                <circle cx="50" cy="50" r="3" fill="#F5C518" className="drift3" />
                <circle cx="550" cy="25" r="3" fill="#5EE6A1" className="drift2" />
                {/* Risk halo on one node */}
                <circle cx="420" cy="70" r="12" fill="none" stroke="#FF4D4D" strokeWidth="1.5" opacity="0.5" className="drift1" />
              </svg>
            </div>

            {/* Mock stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5">
              <div className="bg-ink-900 px-6 py-4 text-center">
                <div className="text-lg font-medium text-ink-50 tabular-nums">847</div>
                <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-0.5">Entities</div>
              </div>
              <div className="bg-ink-900 px-6 py-4 text-center">
                <div className="text-lg font-medium text-ink-50 tabular-nums">1,203</div>
                <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-0.5">Connections</div>
              </div>
              <div className="bg-ink-900 px-6 py-4 text-center">
                <div className="text-lg font-medium text-signal-critical tabular-nums">3</div>
                <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-0.5">Sanctions matches</div>
              </div>
              <div className="bg-ink-900 px-6 py-4 text-center">
                <div className="text-lg font-medium text-signal-medium tabular-nums">42</div>
                <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-0.5">Risk score</div>
              </div>
            </div>

            {/* Mock findings */}
            <div className="border-t border-white/5">
              <div className="px-8 py-4 border-b border-white/5 flex items-center gap-4 hover:bg-white/[0.02]">
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-critical/15 text-signal-critical border-signal-critical/30">CRITICAL</span>
                <span className="text-[10px] font-mono text-ink-500">SHELL_NETWORK</span>
                <span className="text-sm text-ink-300 flex-1 truncate">Director operates 23 micro-entity companies from a single virtual office address</span>
              </div>
              <div className="px-8 py-4 border-b border-white/5 flex items-center gap-4 hover:bg-white/[0.02]">
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-high/15 text-signal-high border-signal-high/30">HIGH</span>
                <span className="text-[10px] font-mono text-ink-500">DISQUALIFIED_DIRECTOR</span>
                <span className="text-sm text-ink-300 flex-1 truncate">John Smith matches a disqualified UK director (87% confidence)</span>
              </div>
              <div className="px-8 py-4 flex items-center gap-4 hover:bg-white/[0.02]">
                <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-medium/15 text-signal-medium border-signal-medium/30">MEDIUM</span>
                <span className="text-[10px] font-mono text-ink-500">PHOENIX_COMPANY</span>
                <span className="text-sm text-ink-300 flex-1 truncate">Acme Holdings Ltd replaced Acme Trading Ltd within 7 days — shared director and address</span>
              </div>
            </div>
          </div>

          {/* Image placeholder */}
          <div className="mt-8 border border-dashed border-white/10 bg-ink-900/50 p-12 text-center">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-600 mb-2">/ Placeholder</div>
            <div className="text-xs text-ink-500">Full product screenshot will go here</div>
          </div>
        </div>
      </section>

      {/* Approach · three numbered cards */}
      <section id="approach" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 003 · Approach
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <Approach
              n="001"
              title="Multi-source intelligence"
              body="UK Companies House, OpenSanctions (4M+ entities), and ICIJ OffshoreLeaks (770K+ officers) unified into one ownership graph with cross-source entity resolution and fuzzy matching."
            />
            <Approach
              n="002"
              title="Deep ownership tracing"
              body="Recursive BFS through directors, PSCs, and addresses. UBO chain resolution traces corporate PSCs until reaching the natural person — computing effective ownership through layers."
            />
            <Approach
              n="003"
              title="20+ risk detectors"
              body="Shell scoring, filing health, phoenix companies, disqualified directors, jurisdiction risk, cross-directorship conflicts, dormant cycling, mass formation, account regression — every signal explained with evidence."
            />
          </div>
        </div>
      </section>

      {/* Data sources */}
      <section id="sources" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 004 · Data sources
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-white/5 border border-white/5">
            <Source
              kind="LIVE API"
              title="UK Companies House"
              body="Company profiles, officers, PSC, filing history, charges, disqualified directors register. 600 req/5 min."
            />
            <Source
              kind="4.1M ENTITIES"
              title="OpenSanctions"
              body="Global sanctions lists, PEPs, criminal entities. FollowTheMoney schema with fuzzy name matching."
            />
            <Source
              kind="770K+ RECORDS"
              title="ICIJ OffshoreLeaks"
              body="Panama Papers, Paradise Papers, Pandora Papers, Bahamas Leaks. Entities, officers, intermediaries."
            />
            <Source
              kind="BUILT-IN"
              title="Jurisdiction risk DB"
              body="Three-tier classification of 20+ jurisdictions. BVI, Cayman, Panama flagged HIGH. Jersey, Malta flagged MEDIUM."
            />
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 005 · Intelligence capabilities
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <Capability
              title="UBO chain resolution"
              body="Traces corporate PSC chains until reaching a natural person. Computes effective ownership %, flags offshore layers and dead ends."
            />
            <Capability
              title="Filing health analysis"
              body="Scores filing discipline, detects account-type regression, dormant cycling, and phoenix company patterns from CH filing history."
            />
            <Capability
              title="Disqualified director check"
              body="Every director is screened against the CH disqualified-officers register with fuzzy name matching. CRITICAL finding on hit."
            />
            <Capability
              title="Cross-directorship conflicts"
              body="Detects same-SIC competitor conflicts, incestuous director cliques, and dual-sided directors across business relationships."
            />
            <Capability
              title="Watchlist monitoring"
              body="Save companies to a watchlist and re-investigate on demand. Track risk score changes over time."
            />
            <Capability
              title="Company comparison"
              body="Compare two investigations side by side. Surfaces shared directors and addresses — hidden connections between supposedly unrelated companies."
            />
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="usecases" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12">
            / 006 · Built for due diligence
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <Approach
              n="001"
              title="Vendor screening"
              body="Map director networks, verify corporate legitimacy, and assess risk exposure before signing contracts."
            />
            <Approach
              n="002"
              title="Investment due diligence"
              body="Trace ownership structures, check founder histories, and identify hidden risks before committing capital."
            />
            <Approach
              n="003"
              title="Compliance & KYB"
              body="Automated sanctions screening, UBO resolution, and continuous risk monitoring for regulated onboarding workflows."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24 text-center">
          <h2 className="text-2xl font-medium tracking-tight text-ink-50 mb-4">Start an investigation</h2>
          <p className="text-sm text-ink-400 mb-10">Enter any UK company name or number.</p>
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(() => searchRef.current?.focus(), 400);
            }}
            className="px-8 py-4 bg-ink-50 text-ink-900 rounded-sm font-medium text-sm hover:bg-white transition-all group/btn"
          >
            <span>Search a company <span className="inline-block transition-transform group-hover/btn:translate-x-1">→</span></span>
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 relative overflow-hidden">
        {/* Subtle radial glow behind logo */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-signal-clean/[0.02] rounded-full blur-[100px] pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-8 py-20">
          {/* Logo + brand */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-sm font-bold">T</div>
            <span className="text-base tracking-tight text-ink-50">TraceGraph</span>
          </div>

          {/* Tagline with typewriter-style mono */}
          <p className="text-center text-sm text-ink-400 mb-10">
            Corporate intelligence from public data.
          </p>

          {/* Links */}
          <div className="flex items-center justify-center gap-8 text-xs font-mono text-ink-500 mb-8">
            <a href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</a>
            <a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a>
            <a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a>
            <span className="text-ink-700">|</span>
            <a href="#" className="hover:text-ink-50 transition-colors">GitHub</a>
            <a href="https://anmolbhardwaj.in" target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors">
              Anmol Bhardwaj
            </a>
          </div>

          {/* Data sources */}
          <div className="text-center text-[10px] font-mono text-ink-600 tracking-[0.15em] uppercase mb-6">
            UK Companies House · OpenSanctions · ICIJ OffshoreLeaks
          </div>

          {/* Copyright + subtle easter egg */}
          <div className="text-center text-[10px] font-mono text-ink-700">
            © 2026 TraceGraph · Every company tells a story — we read between the filings.
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
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors">
      <div className="text-[10px] font-mono text-ink-500 tracking-[0.15em] mb-4">{n}</div>
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Source({ kind, title, body }: { kind: string; title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors">
      <div className="text-[10px] font-mono text-ink-500 tracking-[0.15em] mb-4">{kind}</div>
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function Capability({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors">
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '#approach', label: 'Approach' },
    { href: '#sources', label: 'Sources' },
    { href: '#capabilities', label: 'Capabilities' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/compare', label: 'Compare' },
    { href: '/watchlist', label: 'Watchlist' },
  ];
  return (
    <div className="md:hidden">
      <button onClick={() => setOpen(!open)} className="text-ink-300 hover:text-ink-50 transition-colors p-1">
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" /></svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" /></svg>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 bg-ink-900/95 backdrop-blur-md border-b border-white/5 py-4 px-8">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-sm text-ink-300 hover:text-ink-50 transition-colors">
              {l.label}
            </a>
          ))}
        </div>
      )}
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
