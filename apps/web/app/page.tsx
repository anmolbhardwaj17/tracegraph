'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ThemeToggle } from '../components/ThemeToggle';
const EncryptedText = dynamic(
  () => import('../components/ui/encrypted-text').then((m) => m.EncryptedText),
  { ssr: false, loading: () => <span className="text-ink-400">Uncover everything.</span> },
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SearchHit {
  companyNumber: string;
  title: string;
  name?: string;
  status?: string;
  address?: string;
  incorporated?: string;
  jurisdiction?: string;
  jurisdictionLabel?: string;
  source?: string;
  flag?: string;
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
  const [jurisdiction, setJurisdiction] = useState('gb');
  const debounceRef = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Scroll-triggered animations via Intersection Observer
  useEffect(() => {
    const targets = document.querySelectorAll('.scroll-fade-in, .scroll-slide-in, .stagger-grid');
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, []);

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
        const searchUrl = jurisdiction === 'gb'
          ? `${API}/api/companies-house/search?q=${encodeURIComponent(trimmed)}`
          : `${API}/api/jurisdictions/search?q=${encodeURIComponent(trimmed)}&jurisdiction=${jurisdiction}`;
        const res = await fetch(searchUrl);
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
  }, [query, jurisdiction]);

  function pickCompany(hit: SearchHit) {
    setSelectedHit(hit);
    setShowDropdown(false);
    setHits([]);
    setQuery(hit.title || hit.name || hit.companyNumber);
  }

  async function startInvestigation(q: string, tier: Tier = 'STANDARD') {
    setLoading(true);
    setError(null);
    setShowDropdown(false);
    try {
      const res = await fetch(`${API}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, tier, jurisdiction }),
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
            <a href="#capabilities" className="hover:text-ink-50 transition-colors">Product</a>
            <a href="#capabilities" className="hover:text-ink-50 transition-colors">Capabilities</a>
            <span className="text-ink-700">|</span>
            <a href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</a>
            <a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a>
            <a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a>
            <a href="/leaderboard" className="hover:text-ink-50 transition-colors">Leaderboard</a>
            <ThemeToggle />
          </nav>
          {/* Mobile hamburger */}
          <MobileMenu />
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-48 pb-32 px-8 max-w-6xl mx-auto">
        {/* Dot grid background */}
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />

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
            Trace ownership chains, detect shell networks, screen sanctions across 145+ jurisdictions - from public data, in minutes.
          </p>

          <div className="mt-6 flex items-center gap-6 text-xs font-mono text-ink-500 reveal reveal-delay-2 flex-wrap">
            <CountUp end={235} suffix="M+" label="companies searchable" />
            <span className="text-ink-700">·</span>
            <CountUp end={4.1} suffix="M" label="sanctions entities" decimals={1} />
            <span className="text-ink-700">·</span>
            <CountUp end={770} suffix="K+" label="offshore records" />
            <span className="text-ink-700">·</span>
            <CountUp end={145} suffix="+" label="jurisdictions" />
          </div>

        {/* Search */}
        <form onSubmit={submit} className="mt-12 max-w-2xl reveal reveal-delay-3 relative">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider">Jurisdiction</span>
            {[
              { value: 'gb', label: 'UK', flag: 'GB' },
              { value: 'us', label: 'US', flag: 'US' },
              { value: 'de', label: 'DE', flag: 'DE' },
              { value: 'fr', label: 'FR', flag: 'FR' },
              { value: 'all', label: 'All', flag: '' },
            ].map((j) => (
              <button key={j.value} onClick={() => setJurisdiction(j.value)}
                className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                  jurisdiction === j.value ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                }`}>{j.label}</button>
            ))}
          </div>
          <div className="relative group">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => hits.length > 0 && setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              placeholder={jurisdiction === 'gb' ? 'Enter a UK company name or number...' : jurisdiction === 'all' ? 'Search companies worldwide...' : `Search ${jurisdiction.toUpperCase()} companies...`}
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
                      <div className="text-sm text-ink-50 truncate">{h.title || h.name}</div>
                      <div className="text-[10px] text-ink-500 font-mono mt-0.5 truncate">
                        {h.companyNumber}
                        {h.address && ` · ${h.address}`}
                        {h.jurisdiction && h.jurisdiction !== 'gb' && ` · ${(h.jurisdictionLabel || h.jurisdiction).toUpperCase()}`}
                        {h.source && h.source !== 'companies-house' && ` · ${h.source}`}
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

      {/* Beyond the report - feature strip */}
      <section className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12 scroll-slide-in">
            / 002 · Beyond the report
          </div>
          <div className="overflow-hidden -mx-8">
            <FeatureCarousel>
              <FeatureStrip label="Live expansion" description="Watch your network grow in real time" visual="sonar" />
              <FeatureStrip label="Graph explorer" description="Filter by type, search entities, trace paths" visual="graph" />
              <FeatureStrip label="Ownership chains" description="Trace UBO through corporate layers" visual="ownership" />
              <FeatureStrip label="Intelligence report" description="Professional PDF with verdict, findings, methodology" visual="pdf" />
              <FeatureStrip label="Compare" description="Side-by-side risk analysis of two companies" visual="compare" />
              <FeatureStrip label="Monitor" description="Track risk score changes over time" visual="monitor" />
              <FeatureStrip label="Verify" description="One-click links to source data for every finding" visual="verify" />
              <FeatureStrip label="Leaderboard" description="UK's riskiest companies ranked by risk score" visual="leaderboard" />
            </FeatureCarousel>
          </div>
        </div>
      </section>

      {/* What it detects - merged capabilities */}
      <section id="capabilities" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-4 scroll-slide-in">
            / 003 · What it detects
          </div>
          <p className="text-sm text-ink-400 mb-12 max-w-2xl">
            20+ automated risk signals from three data sources - UK Companies House, OpenSanctions (4.1M entities), and ICIJ OffshoreLeaks (770K+ records).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-white/5 border border-white/5 stagger-grid">
            <Capability title="Shell company networks" body="Multi-factor scoring: director count, rapid dissolutions, dormant accounts, virtual office addresses, micro-entity filings." color="#FF4D4D" icon="shell" />
            <Capability title="UBO chain resolution" body="Traces corporate PSC chains through ownership layers until reaching a natural person. Computes effective ownership % and flags offshore jurisdictions." color="#F5C518" icon="chain" />
            <Capability title="Sanctions & PEP screening" body="Every entity screened against 4.1M OpenSanctions records and 770K ICIJ OffshoreLeaks entries with fuzzy name matching." color="#FF8A3D" icon="shield" />
            <Capability title="Disqualified directors" body="All directors checked against the Companies House disqualified-officers register. CRITICAL finding on match." color="#FF4D4D" icon="ban" />
            <Capability title="Filing & financial health" body="Late filings, account-type regression, dormant cycling, phoenix company patterns, and multi-year filing gaps." color="#5EE6A1" icon="file" />
            <Capability title="Director network conflicts" body="Same-SIC competitor conflicts, incestuous director cliques, cross-directorship patterns, and dual-sided relationships." color="#60A5FA" icon="network" />
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section id="usecases" className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12 scroll-slide-in">
            / 004 · Built for due diligence
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5 stagger-grid">
            <Approach
              n="001"
              title="Vendor screening"
              body="Map director networks, verify corporate legitimacy, and assess risk exposure before signing contracts."
              icon="vendor"
              color="#5EE6A1"
            />
            <Approach
              n="002"
              title="Investment due diligence"
              body="Trace ownership structures, check founder histories, and identify hidden risks before committing capital."
              icon="invest"
              color="#F5C518"
            />
            <Approach
              n="003"
              title="Compliance & KYB"
              body="Automated sanctions screening, UBO resolution, and continuous risk monitoring for regulated onboarding workflows."
              icon="compliance"
              color="#60A5FA"
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
      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-16">
          {/* Top: brand + link columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12 mb-12">
            {/* Brand */}
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
                <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
              </div>
              <p className="text-xs text-ink-400 leading-relaxed">
                Every company tells a story - we read between the filings.
              </p>
            </div>

            {/* Product */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-4">Product</div>
              <ul className="space-y-2.5 text-xs text-ink-400">
                <li><a href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</a></li>
                <li><a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a></li>
                <li><a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a></li>
                <li><a href="/leaderboard" className="hover:text-ink-50 transition-colors">Leaderboard</a></li>
              </ul>
            </div>

            {/* Resources */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-4">Resources</div>
              <ul className="space-y-2.5 text-xs text-ink-400">
                <li><a href="#" className="hover:text-ink-50 transition-colors">GitHub</a></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-4">Legal</div>
              <ul className="space-y-2.5 text-xs text-ink-400">
                <li><a href="/privacy" className="hover:text-ink-50 transition-colors">Privacy Policy</a></li>
                <li><a href="/terms" className="hover:text-ink-50 transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4 text-[10px] font-mono text-ink-500">
            <div>© 2026 TraceGraph. All rights reserved.</div>
            <a href="https://anmolbhardwaj.in" target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors">
              Built by Anmol Bhardwaj
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

function Approach({ n, title, body, icon, color }: { n: string; title: string; body: string; icon: string; color: string }) {
  const icons: Record<string, React.ReactNode> = {
    vendor: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    invest: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    compliance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  };
  return (
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors card-glow border border-transparent">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-sm flex items-center justify-center" style={{ backgroundColor: color + '12', color }}>
          {icons[icon]}
        </div>
        <div className="text-[10px] font-mono tracking-[0.15em]" style={{ color: color + 'AA' }}>{n}</div>
      </div>
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}


function Capability({ title, body, color, icon }: { title: string; body: string; color: string; icon: string }) {
  const icons: Record<string, React.ReactNode> = {
    shell: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    chain: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M8 12h8" strokeLinecap="round" /></svg>,
    shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" /><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    ban: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93l14.14 14.14" /></svg>,
    file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    network: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5"><circle cx="12" cy="5" r="3" /><circle cx="5" cy="19" r="3" /><circle cx="19" cy="19" r="3" /><path d="M12 8v4M8.5 16.5L10.5 13M15.5 16.5l-2-3.5" /></svg>,
  };
  return (
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors card-glow border border-transparent group">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-sm flex items-center justify-center" style={{ backgroundColor: color + '15', color }}>
          {icons[icon] || <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />}
        </div>
        <h3 className="text-base font-medium tracking-tight text-ink-50">{title}</h3>
      </div>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}

function MobileMenu() {
  const [open, setOpen] = useState(false);
  const links = [
    { href: '#approach', label: 'Product' },
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

/** Ambient network canvas for hero background */
function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf: number;
    let W = 0;
    let H = 0;

    // Particles
    type P = { x: number; y: number; vx: number; vy: number };
    let particles: P[] = [];
    const PARTICLE_COUNT = 50;
    const CONNECT_DIST = 120;

    function resize() {
      const rect = container!.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function init() {
      resize();
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      // Move particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
      }

      // Draw connections
      ctx.strokeStyle = 'rgba(94,230,161,0.06)';
      ctx.lineWidth = 1;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.06;
            ctx.strokeStyle = `rgba(94,230,161,${alpha})`;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    }

    init();
    frame();
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

/** Counter that animates from 0 to target on scroll */
function CountUp({ end, suffix = '', label, decimals = 0 }: { end: number; suffix?: string; label: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const duration = 1500;
    const startTime = performance.now();
    let raf: number;
    function tick() {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(eased * end);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, end]);

  return (
    <span ref={ref}>
      <span className="text-ink-300 tabular-nums">{decimals > 0 ? value.toFixed(decimals) : Math.round(value)}{suffix}</span>
      {' '}{label}
    </span>
  );
}

function FeatureCarousel({ children }: { children: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef<number | null>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function tick() {
      if (!pausedRef.current && el) {
        el.scrollLeft += 0.6;
        // Loop: when we've scrolled past half (duplicate content), reset
        if (el.scrollLeft >= el.scrollWidth / 2) {
          el.scrollLeft = 0;
        }
      }
      autoRef.current = requestAnimationFrame(tick);
    }
    autoRef.current = requestAnimationFrame(tick);
    return () => { if (autoRef.current) cancelAnimationFrame(autoRef.current); };
  }, []);

  return (
    <div
      ref={scrollRef}
      className="flex gap-4 overflow-x-auto scrollbar-hide px-8 cursor-grab active:cursor-grabbing"
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
      onTouchStart={() => { pausedRef.current = true; }}
      onTouchEnd={() => { setTimeout(() => { pausedRef.current = false; }, 2000); }}
    >
      {/* Duplicate children for seamless loop */}
      {children}
      {children}
    </div>
  );
}

function FeatureStrip({ label, description, visual }: { label: string; description: string; visual: string }) {
  return (
    <div className="min-w-[220px] max-w-[260px] flex-shrink-0 snap-start border border-white/5 bg-ink-900 overflow-hidden card-glow border-transparent">
      <div className="aspect-[4/3] bg-ink-950/50 border-b border-white/5 flex items-center justify-center p-4">
        <FeatureVisual type={visual} />
      </div>
      <div className="p-5">
        <div className="text-sm font-medium text-ink-50 mb-1">{label}</div>
        <div className="text-xs text-ink-400 leading-relaxed">{description}</div>
      </div>
    </div>
  );
}

function FeatureVisual({ type }: { type: string }) {
  if (type === 'sonar') {
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <style>{`
          @keyframes sonarExpand1 { 0% { opacity: 0.5; } 100% { opacity: 0; } }
          @keyframes sonarExpand2 { 0% { opacity: 0.35; } 100% { opacity: 0; } }
          .sw1 { animation: sonarExpand1 2.4s ease-out infinite; }
          .sw2 { animation: sonarExpand2 2.4s ease-out 1.2s infinite; }
          @keyframes orbitSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .orbit { animation: orbitSlow 20s linear infinite; transform-origin: 60px 45px; }
          @keyframes centerPulse { 0%,100% { opacity: 0.08; } 50% { opacity: 0.2; } }
        `}</style>
        {/* Grid rings - tilted ellipses like real sonar */}
        {[14, 24, 34, 44].map((r, i) => (
          <ellipse key={i} cx="60" cy="45" rx={r} ry={r * 0.62} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
        ))}
        {/* Cross lines */}
        <line x1="16" y1="45" x2="104" y2="45" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        <line x1="60" y1="17" x2="60" y2="73" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        {/* Expanding pulse waves */}
        <ellipse className="sw1" cx="60" cy="45" rx="5" ry="3.1" fill="none" stroke="rgba(94,230,161,0.5)" strokeWidth="1">
          <animate attributeName="rx" values="5;44" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="ry" values="3.1;27" dur="2.4s" repeatCount="indefinite" />
        </ellipse>
        <ellipse className="sw2" cx="60" cy="45" rx="5" ry="3.1" fill="none" stroke="rgba(94,230,161,0.35)" strokeWidth="0.8">
          <animate attributeName="rx" values="5;44" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
          <animate attributeName="ry" values="3.1;27" dur="2.4s" begin="1.2s" repeatCount="indefinite" />
        </ellipse>
        {/* Orbiting blips */}
        <g className="orbit">
          {[[18, 0], [30, 45], [38, 120], [25, 200], [35, 280], [15, 330]].map(([r, a], i) => {
            const rad = (a * Math.PI) / 180;
            const x = 60 + Math.cos(rad) * r;
            const y = 45 + Math.sin(rad) * r * 0.62;
            return (
              <circle key={i} cx={x} cy={y} r="1.3" fill="rgba(200,200,200,0.6)">
                <animate attributeName="opacity" values="0.3;0.9;0.3" dur={`${1.8 + i * 0.3}s`} repeatCount="indefinite" />
              </circle>
            );
          })}
        </g>
        {/* Center glow */}
        <circle cx="60" cy="45" r="10" fill="rgba(94,230,161,0.08)">
          <animate attributeName="r" values="8;12;8" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.06;0.15;0.06" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="60" cy="45" r="5" fill="rgba(94,230,161,0.15)" />
        <circle cx="60" cy="45" r="2.5" fill="#F5F5F5" />
      </svg>
    );
  }
  if (type === 'graph') {
    // Dense network - 25+ nodes in clusters
    const nodes: [number, number, string, number][] = [
      // [x, y, color, size] — center hub
      [60, 40, '#F5C518', 5],
      // Inner ring - directors (green)
      [40, 22, '#5EE6A1', 3], [80, 22, '#5EE6A1', 3], [35, 50, '#5EE6A1', 3],
      [85, 50, '#5EE6A1', 2.5], [50, 65, '#5EE6A1', 2.5], [70, 65, '#5EE6A1', 2.5],
      // Outer ring - companies (yellow/gray)
      [18, 12, '#F5C518', 2], [42, 8, '#F5C518', 2], [78, 8, '#F5C518', 2],
      [102, 12, '#737373', 2], [12, 35, '#737373', 1.8], [108, 35, '#F5C518', 2],
      [15, 60, '#737373', 1.8], [105, 60, '#737373', 1.8], [30, 75, '#737373', 1.5],
      [90, 75, '#737373', 1.5], [60, 78, '#737373', 1.5],
      // Distant nodes
      [5, 20, '#FF4D4D', 1.5], [115, 20, '#737373', 1.3], [5, 70, '#737373', 1.3],
      [115, 70, '#737373', 1.3], [50, 3, '#737373', 1.3], [70, 3, '#737373', 1.3],
    ];
    const edges: [number, number][] = [
      [0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
      [1,7],[1,8],[1,11],[2,9],[2,10],[2,12],
      [3,11],[3,13],[4,12],[4,14],[5,15],[5,17],[6,16],[6,17],
      [7,18],[8,22],[9,23],[10,19],[13,20],[14,21],
      [1,2],[3,5],[4,6],[7,8],[15,17],
    ];
    return (
      <svg viewBox="0 0 120 82" className="w-full h-full">
        <style>{`
          @keyframes edgePulse { 0%,100% { stroke-opacity: 0.1; } 50% { stroke-opacity: 0.3; } }
          @keyframes nodeAppear { 0% { r: 0; opacity: 0; } 100% { r: var(--r); opacity: 1; } }
          @keyframes haloGlow { 0%,100% { r: 7; opacity: 0.05; } 50% { r: 10; opacity: 0.12; } }
        `}</style>
        {edges.map(([a, b], i) => (
          <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
            stroke={nodes[a][2] === '#FF4D4D' || nodes[b][2] === '#FF4D4D' ? 'rgba(255,77,77,0.2)' : 'rgba(94,230,161,0.12)'}
            strokeWidth="0.6" style={{ animation: `edgePulse ${2.5 + (i % 5) * 0.4}s ease-in-out ${i * 0.1}s infinite` }} />
        ))}
        {/* Center halo */}
        <circle cx="60" cy="40" fill="rgba(245,197,24,0.06)" style={{ animation: 'haloGlow 3s ease-in-out infinite' }}>
          <animate attributeName="r" values="7;11;7" dur="3s" repeatCount="indefinite" />
        </circle>
        {/* Risk halo on flagged node */}
        <circle cx="5" cy="20" r="4" fill="none" stroke="rgba(255,77,77,0.3)" strokeWidth="0.6">
          <animate attributeName="opacity" values="0.2;0.6;0.2" dur="1.5s" repeatCount="indefinite" />
        </circle>
        {nodes.map(([x, y, color, size], i) => (
          <circle key={i} cx={x} cy={y} r={size} fill={color} opacity={i === 0 ? 1 : 0.7}>
            <animate attributeName="r" values={`${size};${size * 1.15};${size}`} dur={`${2.5 + (i % 4) * 0.5}s`} repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
    );
  }
  if (type === 'ownership') {
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <style>{`
          @keyframes dashDown { from { stroke-dashoffset: 10; } to { stroke-dashoffset: 0; } }
          .own-line { animation: dashDown 1.2s linear infinite; }
          @keyframes boxPulse { 0%,100% { stroke-opacity: 0.3; } 50% { stroke-opacity: 0.6; } }
          .own-box { animation: boxPulse 3s ease-in-out infinite; }
          @keyframes flagPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
        `}</style>
        {/* Level 0: UBO - natural person */}
        <circle cx="60" cy="7" r="4" fill="#5EE6A1">
          <animate attributeName="r" values="4;5;4" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <text x="60" y="9" textAnchor="middle" fontSize="3.5" fill="#FFF" fontFamily="monospace">UBO</text>

        {/* Level 1: Offshore holdco (Cayman) + second UBO */}
        <line className="own-line" x1="60" y1="11" x2="38" y2="22" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />
        <line className="own-line" x1="60" y1="11" x2="82" y2="22" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />

        <rect className="own-box" x="22" y="22" width="32" height="10" rx="1.5" fill="rgba(255,77,77,0.1)" stroke="rgba(255,77,77,0.3)" strokeWidth="0.5" />
        <text x="38" y="28" textAnchor="middle" fontSize="3" fill="#FF8A3D" fontFamily="monospace">Cayman Holdco</text>
        <text x="54" y="29" fontSize="2.5" fill="rgba(255,77,77,0.6)" fontFamily="monospace" style={{animation: 'flagPulse 2s infinite'}}>KY</text>

        <circle cx="82" cy="27" r="3" fill="#5EE6A1" opacity="0.6" />
        <text x="82" y="28.5" textAnchor="middle" fontSize="3" fill="#FFF" fontFamily="monospace">B</text>
        <text x="82" y="34" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.3)" fontFamily="monospace">25%</text>

        {/* Level 2: Jersey SPV + UK Holdco */}
        <line className="own-line" x1="38" y1="32" x2="28" y2="43" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />
        <line className="own-line" x1="38" y1="32" x2="60" y2="43" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />
        <line className="own-line" x1="82" y1="30" x2="92" y2="43" stroke="rgba(94,230,161,0.3)" strokeWidth="0.6" strokeDasharray="2,2" />

        <rect className="own-box" x="12" y="43" width="32" height="10" rx="1.5" fill="rgba(255,77,77,0.08)" stroke="rgba(255,77,77,0.25)" strokeWidth="0.5" style={{animationDelay: '0.5s'}} />
        <text x="28" y="49" textAnchor="middle" fontSize="3" fill="#FF8A3D" fontFamily="monospace">Jersey SPV</text>
        <text x="44" y="50" fontSize="2.5" fill="rgba(255,77,77,0.5)" fontFamily="monospace">JE</text>

        <rect className="own-box" x="48" y="43" width="24" height="10" rx="1.5" fill="rgba(245,197,24,0.12)" stroke="rgba(245,197,24,0.3)" strokeWidth="0.5" style={{animationDelay: '1s'}} />
        <text x="60" y="49" textAnchor="middle" fontSize="3" fill="#F5C518" fontFamily="monospace">UK Holdco</text>

        <rect className="own-box" x="80" y="43" width="28" height="10" rx="1.5" fill="rgba(245,197,24,0.08)" stroke="rgba(245,197,24,0.2)" strokeWidth="0.5" style={{animationDelay: '1.5s'}} />
        <text x="94" y="49" textAnchor="middle" fontSize="3" fill="rgba(245,197,24,0.6)" fontFamily="monospace">NL Entity</text>

        {/* Level 3: UK Group company */}
        <line className="own-line" x1="28" y1="53" x2="45" y2="63" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />
        <line className="own-line" x1="60" y1="53" x2="45" y2="63" stroke="rgba(245,197,24,0.4)" strokeWidth="0.8" strokeDasharray="2,2" />
        <line className="own-line" x1="94" y1="53" x2="85" y2="63" stroke="rgba(94,230,161,0.2)" strokeWidth="0.6" strokeDasharray="2,2" />

        <rect className="own-box" x="30" y="63" width="30" height="10" rx="1.5" fill="rgba(245,197,24,0.12)" stroke="rgba(245,197,24,0.3)" strokeWidth="0.5" style={{animationDelay: '2s'}} />
        <text x="45" y="69" textAnchor="middle" fontSize="3" fill="#F5C518" fontFamily="monospace">Group Ltd</text>

        <rect x="75" y="63" width="20" height="10" rx="1.5" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.4" />
        <text x="85" y="69" textAnchor="middle" fontSize="3" fill="rgba(255,255,255,0.3)" fontFamily="monospace">Sub</text>

        {/* Level 4: Target */}
        <line className="own-line" x1="45" y1="73" x2="45" y2="80" stroke="rgba(94,230,161,0.5)" strokeWidth="1" strokeDasharray="2,2" />
        <rect x="30" y="80" width="30" height="8" rx="1.5" fill="rgba(94,230,161,0.12)" stroke="rgba(94,230,161,0.35)" strokeWidth="0.6">
          <animate attributeName="stroke-opacity" values="0.3;0.7;0.3" dur="2s" repeatCount="indefinite" />
        </rect>
        <text x="45" y="85" textAnchor="middle" fontSize="3.5" fill="#5EE6A1" fontFamily="monospace" fontWeight="bold">TARGET</text>

        {/* Ownership percentages */}
        <text x="46" y="18" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.25)" fontFamily="monospace">75%</text>
        <text x="74" y="18" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.25)" fontFamily="monospace">25%</text>
        <text x="20" y="40" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.2)" fontFamily="monospace">100%</text>
        <text x="52" y="40" textAnchor="middle" fontSize="2.5" fill="rgba(255,255,255,0.2)" fontFamily="monospace">100%</text>
      </svg>
    );
  }
  if (type === 'pdf') {
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <style>{`
          @keyframes scanLine { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 0.6; } 90% { opacity: 0.6; } 100% { transform: translateY(70px); opacity: 0; } }
          .pdf-scan { animation: scanLine 4s ease-in-out infinite; }
        `}</style>
        <rect x="30" y="5" width="60" height="80" rx="2" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
        <rect className="pdf-scan" x="30" y="5" width="60" height="1" fill="rgba(94,230,161,0.4)" />
        <rect x="38" y="12" width="30" height="3" rx="1" fill="rgba(255,255,255,0.15)" />
        <rect x="38" y="19" width="44" height="2" rx="0.5" fill="rgba(255,255,255,0.06)" />
        <rect x="38" y="23" width="40" height="2" rx="0.5" fill="rgba(255,255,255,0.06)" />
        <rect x="38" y="30" width="44" height="8" rx="1" fill="rgba(234,88,12,0.15)" stroke="rgba(234,88,12,0.3)" strokeWidth="0.4">
          <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
        </rect>
        <text x="60" y="35" textAnchor="middle" fontSize="4" fill="#EA580C" fontFamily="monospace">EDD</text>
        <rect x="38" y="42" width="20" height="10" rx="1" fill="rgba(255,255,255,0.04)" />
        <rect x="60" y="42" width="22" height="10" rx="1" fill="rgba(255,255,255,0.04)" />
        <text x="48" y="49" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">60</text>
        <rect x="38" y="56" width="44" height="2" rx="0.5" fill="rgba(220,38,38,0.3)"><animate attributeName="width" values="0;44;44" dur="3s" repeatCount="indefinite" /></rect>
        <rect x="38" y="60" width="30" height="2" rx="0.5" fill="rgba(245,158,11,0.3)"><animate attributeName="width" values="0;30;30" dur="3s" begin="0.3s" repeatCount="indefinite" /></rect>
        <rect x="38" y="64" width="38" height="2" rx="0.5" fill="rgba(255,255,255,0.06)"><animate attributeName="width" values="0;38;38" dur="3s" begin="0.6s" repeatCount="indefinite" /></rect>
        <rect x="38" y="68" width="25" height="2" rx="0.5" fill="rgba(255,255,255,0.06)"><animate attributeName="width" values="0;25;25" dur="3s" begin="0.9s" repeatCount="indefinite" /></rect>
      </svg>
    );
  }
  if (type === 'compare') {
    const barWidths = [[28, 32], [35, 22], [20, 36], [30, 28]];
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <rect x="8" y="10" width="48" height="70" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
        <rect x="64" y="10" width="48" height="70" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
        <text x="32" y="25" textAnchor="middle" fontSize="14" fill="#5EE6A1" fontFamily="monospace" fontWeight="bold">25</text>
        <text x="88" y="25" textAnchor="middle" fontSize="14" fill="#FF4D4D" fontFamily="monospace" fontWeight="bold">72</text>
        <text x="32" y="32" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.3)" fontFamily="monospace">LOW</text>
        <text x="88" y="32" textAnchor="middle" fontSize="4" fill="rgba(255,255,255,0.3)" fontFamily="monospace">HIGH</text>
        {[40, 48, 56, 64].map((y, i) => (
          <g key={i}>
            <rect x="14" y={y} height="4" rx="1" fill={i < 2 ? 'rgba(94,230,161,0.25)' : 'rgba(255,255,255,0.08)'}>
              <animate attributeName="width" values={`0;${barWidths[i][0]};${barWidths[i][0]}`} dur="2.5s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
            </rect>
            <rect x="70" y={y} height="4" rx="1" fill={i > 1 ? 'rgba(255,77,77,0.25)' : 'rgba(255,255,255,0.08)'}>
              <animate attributeName="width" values={`0;${barWidths[i][1]};${barWidths[i][1]}`} dur="2.5s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
            </rect>
          </g>
        ))}
      </svg>
    );
  }
  if (type === 'monitor') {
    const items = [
      { name: 'Acme Corp', score: 35, prev: 33, color: '#5EE6A1' },
      { name: 'Globex Inc', score: 62, prev: 48, color: '#FF4D4D' },
      { name: 'Initech Ltd', score: 45, prev: 45, color: '#F5C518' },
      { name: 'Wayne Ent', score: 28, prev: 35, color: '#5EE6A1' },
    ];
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <style>{`
          @keyframes mSlide { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: translateY(0); } }
          @keyframes mPulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
        `}</style>
        {items.map((item, i) => {
          const y = 8 + i * 20;
          const delta = item.score - item.prev;
          const barW = (item.score / 100) * 40;
          return (
            <g key={i} style={{ animation: `mSlide 0.5s ease-out ${i * 0.1}s both` }}>
              <rect x="8" y={y} width="104" height="16" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" />
              {/* Avatar circle */}
              <circle cx="18" cy={y + 8} r="4" fill="rgba(255,255,255,0.06)" />
              <text x="18" y={y + 9.5} textAnchor="middle" fontSize="3.5" fill="rgba(255,255,255,0.3)" fontFamily="monospace">{item.name[0]}</text>
              {/* Company name */}
              <text x="26" y={y + 7} fontSize="3.5" fill="rgba(255,255,255,0.5)" fontFamily="monospace">{item.name}</text>
              {/* Score bar */}
              <rect x="26" y={y + 10} width="40" height="2.5" rx="0.5" fill="rgba(255,255,255,0.04)" />
              <rect x="26" y={y + 10} height="2.5" rx="0.5" fill={item.color} opacity="0.4">
                <animate attributeName="width" values={`0;${barW}`} dur="1.2s" begin={`${i * 0.15}s`} fill="freeze" />
              </rect>
              {/* Score number */}
              <text x="78" y={y + 10} fontSize="5" fill={item.color} fontFamily="monospace" fontWeight="bold" style={{ animation: 'mPulse 2.5s ease-in-out infinite' }}>{item.score}</text>
              {/* Delta */}
              {delta !== 0 && (
                <g>
                  <text x="92" y={y + 10} fontSize="3.5" fill={delta > 0 ? '#FF4D4D' : '#5EE6A1'} fontFamily="monospace">
                    {delta > 0 ? `+${delta}` : delta}
                  </text>
                  <text x="104" y={y + 10} fontSize="4" fill={delta > 0 ? '#FF4D4D' : '#5EE6A1'}>
                    {delta > 0 ? '\u25B2' : '\u25BC'}
                  </text>
                </g>
              )}
              {delta === 0 && <text x="94" y={y + 10} fontSize="3.5" fill="rgba(255,255,255,0.2)" fontFamily="monospace">--</text>}
            </g>
          );
        })}
      </svg>
    );
  }
  if (type === 'verify') {
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        <style>{`
          @keyframes checkScan { 0% { transform: translateX(-10px); opacity: 0; } 30% { opacity: 1; } 70% { opacity: 1; } 100% { transform: translateX(96px); opacity: 0; } }
          .verify-scan { animation: checkScan 3s ease-in-out infinite; }
          @keyframes linkGlow { 0%,100% { fill: rgba(37,99,235,0.08); } 50% { fill: rgba(37,99,235,0.2); } }
          .link-bg { animation: linkGlow 2s ease-in-out infinite; }
          .link-bg2 { animation: linkGlow 2s ease-in-out 0.8s infinite; }
        `}</style>
        <rect x="12" y="10" width="96" height="70" rx="2" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.6" />
        {/* Scanning line */}
        <rect className="verify-scan" x="12" y="10" width="2" height="70" rx="1" fill="rgba(94,230,161,0.3)" />
        <rect x="18" y="16" width="24" height="8" rx="1.5" fill="rgba(220,38,38,0.15)">
          <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
        </rect>
        <text x="30" y="22" textAnchor="middle" fontSize="5" fill="#DC2626" fontFamily="monospace">CRITICAL</text>
        <rect x="18" y="28" width="60" height="2.5" rx="0.5" fill="rgba(255,255,255,0.12)" />
        <rect x="18" y="33" width="50" height="2" rx="0.5" fill="rgba(255,255,255,0.06)" />
        <rect x="18" y="37" width="55" height="2" rx="0.5" fill="rgba(255,255,255,0.06)" />
        <rect className="link-bg" x="18" y="46" width="40" height="7" rx="1.5" stroke="rgba(37,99,235,0.3)" strokeWidth="0.5" />
        <text x="38" y="51" textAnchor="middle" fontSize="4" fill="#60A5FA" fontFamily="monospace">View on CH {'>'}</text>
        <rect className="link-bg2" x="18" y="57" width="45" height="7" rx="1.5" stroke="rgba(37,99,235,0.3)" strokeWidth="0.5" />
        <text x="40" y="62" textAnchor="middle" fontSize="4" fill="#60A5FA" fontFamily="monospace">OpenSanctions {'>'}</text>
        {/* Checkmark appearing */}
        <circle cx="96" cy="20" r="5" fill="rgba(94,230,161,0.15)">
          <animate attributeName="opacity" values="0;0;1;1;0" dur="3s" repeatCount="indefinite" />
        </circle>
        <path d="M93,20 l2,2 l4,-4" fill="none" stroke="#5EE6A1" strokeWidth="1.2" strokeLinecap="round">
          <animate attributeName="opacity" values="0;0;1;1;0" dur="3s" repeatCount="indefinite" />
        </path>
      </svg>
    );
  }
  if (type === 'leaderboard') {
    return (
      <svg viewBox="0 0 120 90" className="w-full h-full">
        {[0, 1, 2, 3, 4].map((i) => {
          const y = 12 + i * 15;
          const w = [80, 65, 55, 45, 35][i];
          const color = i === 0 ? '#FF4D4D' : i === 1 ? '#FF8A3D' : i === 2 ? '#F5C518' : 'rgba(255,255,255,0.15)';
          return (
            <g key={i}>
              <text x="16" y={y + 8} textAnchor="middle" fontSize="6" fill="rgba(255,255,255,0.3)" fontFamily="monospace">#{i + 1}</text>
              <rect x="24" y={y + 1} width="50" height="3" rx="0.5" fill="rgba(255,255,255,0.08)" />
              <rect x="24" y={y + 7} height="4" rx="1" fill={color} opacity="0.3">
                <animate attributeName="width" values={`0;${w};${w}`} dur="2s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
              </rect>
              <rect x="24" y={y + 7} height="4" rx="1" fill={color} opacity="0.6">
                <animate attributeName="width" values={`0;${w * 0.7};${w * 0.7}`} dur="2s" begin={`${i * 0.2 + 0.1}s`} repeatCount="indefinite" />
              </rect>
            </g>
          );
        })}
      </svg>
    );
  }
  // Default fallback
  return (
    <div className="w-10 h-10 rounded-sm bg-ink-850 border border-white/10 flex items-center justify-center">
      <div className="w-4 h-4 border border-white/15 rounded-sm" />
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
