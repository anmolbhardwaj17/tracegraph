'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
const EncryptedText = dynamic(
  () => import('../components/ui/encrypted-text').then((m) => m.EncryptedText),
  { ssr: false, loading: () => <span className="text-ink-400">Uncover everything.</span> },
);

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
            <a href="#capabilities" className="hover:text-ink-50 transition-colors">Product</a>
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
        {/* Ambient network canvas */}
        <HeroCanvas />

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
            Trace ownership chains, detect shell networks, screen sanctions - from public data, in minutes.
          </p>

          <div className="mt-6 flex items-center gap-6 text-xs font-mono text-ink-500 reveal reveal-delay-2 flex-wrap">
            <CountUp end={6} suffix="M+" label="UK companies" />
            <span className="text-ink-700">·</span>
            <CountUp end={4.1} suffix="M" label="sanctions entities" decimals={1} />
            <span className="text-ink-700">·</span>
            <CountUp end={770} suffix="K+" label="offshore records" />
            <span className="text-ink-700">·</span>
            <CountUp end={20} suffix="+" label="risk signals" />
          </div>

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

      {/* Beyond the report - feature strip */}
      <section className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-24">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-400 mb-12 scroll-slide-in">
            / 002 · Beyond the report
          </div>
          <div className="overflow-hidden -mx-8">
            <div className="marquee-track gap-4">
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-4 shrink-0 pr-4">
                  <FeatureStrip label="Live expansion" description="Watch your network grow in real time" placeholder="sonar animation" />
                  <FeatureStrip label="Graph explorer" description="Filter by type, search entities, trace paths" placeholder="interactive graph" />
                  <FeatureStrip label="Ownership chains" description="Trace UBO through corporate layers" placeholder="chain diagram" />
                  <FeatureStrip label="Compare" description="Find shared directors between any two companies" placeholder="comparison view" />
                  <FeatureStrip label="Monitor" description="Add to watchlist. Re-investigate anytime." placeholder="watchlist view" />
                </div>
              ))}
            </div>
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
            <Capability title="Shell company networks" body="Multi-factor scoring: director count, rapid dissolutions, dormant accounts, virtual office addresses, micro-entity filings." />
            <Capability title="UBO chain resolution" body="Traces corporate PSC chains through ownership layers until reaching a natural person. Computes effective ownership % and flags offshore jurisdictions." />
            <Capability title="Sanctions & PEP screening" body="Every entity screened against 4.1M OpenSanctions records and 770K ICIJ OffshoreLeaks entries with fuzzy name matching." />
            <Capability title="Disqualified directors" body="All directors checked against the Companies House disqualified-officers register. CRITICAL finding on match." />
            <Capability title="Filing & financial health" body="Late filings, account-type regression, dormant cycling, phoenix company patterns, and multi-year filing gaps." />
            <Capability title="Director network conflicts" body="Same-SIC competitor conflicts, incestuous director cliques, cross-directorship patterns, and dual-sided relationships." />
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
      <footer className="border-t border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {/* Main row */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            {/* Left: logo + copyright */}
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-[10px] font-bold">T</div>
              <span className="text-xs font-mono text-ink-500">© 2026 TraceGraph</span>
            </div>

            {/* Center: links */}
            <div className="flex items-center gap-5 text-xs font-mono text-ink-500">
              <a href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</a>
              <a href="/compare" className="hover:text-ink-50 transition-colors">Compare</a>
              <a href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</a>
              <a href="/privacy" className="hover:text-ink-50 transition-colors">Privacy</a>
              <a href="/terms" className="hover:text-ink-50 transition-colors">Terms</a>
            </div>

            {/* Right: external */}
            <div className="flex items-center gap-5 text-xs font-mono text-ink-500">
              <a href="#" className="hover:text-ink-50 transition-colors">GitHub</a>
              <a href="https://anmolbhardwaj.in" target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors">Anmol Bhardwaj</a>
            </div>
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
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors card-glow border border-transparent">
      <div className="text-[10px] font-mono text-ink-500 tracking-[0.15em] mb-4">{n}</div>
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
      <p className="text-sm text-ink-300 leading-relaxed">{body}</p>
    </div>
  );
}


function Capability({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-ink-900 p-8 hover:bg-ink-850 transition-colors card-glow border border-transparent">
      <h3 className="text-base font-medium tracking-tight text-ink-50 mb-3">{title}</h3>
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

function FeatureStrip({ label, description, placeholder }: { label: string; description: string; placeholder: string }) {
  return (
    <div className="min-w-[220px] max-w-[260px] flex-shrink-0 snap-start border border-white/5 bg-ink-900 overflow-hidden card-glow border-transparent">
      {/* Image placeholder */}
      <div className="aspect-[4/3] bg-ink-950/50 border-b border-white/5 flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-10 h-10 rounded-sm bg-ink-850 border border-white/10 flex items-center justify-center mx-auto mb-3">
            <div className="w-4 h-4 border border-white/15 rounded-sm" />
          </div>
          <div className="text-[9px] font-mono text-ink-600 uppercase tracking-wider">{placeholder}</div>
        </div>
      </div>
      {/* Text */}
      <div className="p-5">
        <div className="text-sm font-medium text-ink-50 mb-1">{label}</div>
        <div className="text-xs text-ink-400 leading-relaxed">{description}</div>
      </div>
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
