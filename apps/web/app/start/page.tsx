'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';
import { NavBar } from '../../components/NavBar';
import { Avatar } from '../../components/Avatar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';
const COMPANY_NUMBER_RE = /^(?:\d{6,8}|[A-Z]{2}\d{6})$/i;
const URL_RE = /^(https?:\/\/)?([a-z0-9\-]+\.)+[a-z]{2,}(\/.*)?$/i;

type Tier = 'QUICK' | 'STANDARD' | 'DEEP';

interface Hit {
  companyNumber: string; title: string; name?: string;
  status?: string; jurisdiction?: string; jurisdictionLabel?: string;
  source?: string; address?: string;
}

export default function StartPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user, token, loading: authLoading } = useAuth();

  // Pre-filled from URL (coming from home page search)
  const prefillCompany = sp.get('company') || '';
  const prefillName = sp.get('name') || '';
  const prefillJurisdiction = sp.get('jurisdiction') || 'gb';
  const prefillTier = (sp.get('tier') as Tier) || null;
  const autostart = sp.get('autostart') === '1';

  const [jurisdiction, setJurisdiction] = useState(prefillJurisdiction);
  const [selected, setSelected] = useState<Hit | null>(
    prefillCompany ? { companyNumber: prefillCompany, title: prefillName } : null
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search state (for fresh arrival with no company)
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);

  // Auto-start: user came back from auth with all params set
  useEffect(() => {
    if (!authLoading && user && token && autostart && prefillCompany && prefillTier) {
      fireInvestigation(prefillCompany, prefillTier);
    }
  }, [authLoading, user]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed || COMPANY_NUMBER_RE.test(trimmed) || trimmed.length < 2 || selected) {
      setHits([]); setShowDropdown(false); return;
    }

    // If input looks like a URL/domain — show domain research option immediately
    if (URL_RE.test(trimmed) && trimmed.includes('.')) {
      const domain = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
      setHits([{ companyNumber: `domain:${domain}`, title: `Research ${domain}`, name: domain, source: 'domain', status: 'website' }]);
      setShowDropdown(true);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = jurisdiction === 'gb'
          ? `${API}/api/companies-house/search?q=${encodeURIComponent(trimmed)}`
          : `${API}/api/jurisdictions/search?q=${encodeURIComponent(trimmed)}&jurisdiction=${jurisdiction}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const registryHits = data.items || [];

        // Always append a "Research from web" fallback — place it at end if results exist, at top if not
        const webHit: Hit = {
          companyNumber: `web:${trimmed}`,
          title: `Research "${trimmed}" from the web`,
          name: trimmed,
          source: 'domain',
          status: registryHits.length === 0 ? 'not found in registries' : 'web fallback',
        };

        const combined = registryHits.length > 0
          ? [...registryHits, webHit]
          : [webHit];

        setHits(combined);
        setShowDropdown(true);
        setActiveIdx(-1);
      } catch { setHits([]); } finally { setSearching(false); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, jurisdiction, selected]);

  function pickHit(hit: Hit) {
    if ((hit as any).source === 'domain') {
      // Web research hit — use company name or domain as query
      const nameOrDomain = hit.name || hit.companyNumber.replace(/^(domain:|web:)/, '');
      setSelected({ ...hit, title: nameOrDomain });
      setQuery(nameOrDomain);
      setJurisdiction('domain');
      setShowDropdown(false);
      setHits([]);
      return;
    }
    setSelected(hit);
    setQuery(hit.title || hit.name || hit.companyNumber);
    setShowDropdown(false);
    setHits([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % hits.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i <= 0 ? hits.length - 1 : i - 1)); }
    else if (e.key === 'Escape') setShowDropdown(false);
    else if (e.key === 'Enter' && hits[activeIdx]) { e.preventDefault(); pickHit(hits[activeIdx]); }
  }

  async function fireInvestigation(company: string, tier: Tier) {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: company, tier, jurisdiction }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) {
        setError(data.upgrade ? `${data.error} — upgrade to Pro for more.` : data.error);
        setStarting(false);
        return;
      }
      router.push(`/investigate/${data.id}`);
    } catch (err: any) {
      setError(err.message);
      setStarting(false);
    }
  }

  function handleStart(tier: Tier) {
    if (!selected) return;
    if (!user || !token) {
      // Preserve all state in URL → redirect to auth → come back with autostart
      const returnUrl = `/start?company=${encodeURIComponent(selected.companyNumber)}&name=${encodeURIComponent(selected.title)}&jurisdiction=${jurisdiction}&tier=${tier}&autostart=1`;
      router.push(`/auth?redirect=${encodeURIComponent(returnUrl)}`);
      return;
    }
    fireInvestigation(selected.companyNumber, tier);
  }

  if (autostart && !error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-8 h-8 border-2 border-ink-500 border-t-ink-50 rounded-full animate-spin mx-auto" />
          <p className="text-sm text-ink-400 font-mono">Starting your investigation…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="max-w-3xl mx-auto px-8 pt-32 pb-24">
        {/* Header */}
        <div className="mb-12">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            {selected ? '/ Step 2 of 2 · Choose depth' : '/ Start an investigation'}
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-ink-50">
            {selected ? 'How deep should we go?' : 'Which company?'}
          </h1>
        </div>

        {/* Search (shown when no company selected) */}
        {!selected && (
          <div className="mb-10">
            {/* Jurisdiction */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider">Jurisdiction</span>
              {[
                { value: 'gb', label: 'UK' },
                { value: 'us', label: 'US' },
                { value: 'in', label: 'IN' },
                { value: 'de', label: 'DE' },
                { value: 'fr', label: 'FR' },
                { value: 'all', label: 'All' },
              ].map((j) => (
                <button key={j.value} onClick={() => setJurisdiction(j.value)}
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                    jurisdiction === j.value ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                  }`}>{j.label}
                </button>
              ))}
            </div>

            {/* Search input */}
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => hits.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder={
                  jurisdiction === 'gb' ? 'Enter a UK company name or number…' :
                  jurisdiction === 'in' ? 'Search Indian companies by name or CIN…' :
                  `Search ${jurisdiction.toUpperCase()} companies…`
                }
                autoComplete="off"
                autoFocus
                className="w-full px-6 py-5 text-lg rounded-sm bg-ink-850 border border-white/10 text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
              />
              {searching && (
                <span className="absolute right-5 top-1/2 -translate-y-1/2">
                  <span className="w-4 h-4 border border-ink-500 border-t-ink-200 rounded-full animate-spin inline-block" />
                </span>
              )}

              {/* Dropdown */}
              {showDropdown && hits.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 bg-ink-850 border border-white/10 rounded-sm shadow-2xl z-30 overflow-hidden">
                  {hits.map((h, i) => {
                    const isDomain = (h as any).source === 'domain';
                    return (
                      <button key={h.companyNumber} type="button"
                        onMouseDown={(e) => { e.preventDefault(); pickHit(h); }}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`w-full text-left px-5 py-3 flex items-center justify-between gap-4 border-b border-white/5 last:border-b-0 transition-colors ${
                          activeIdx === i ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                        } ${isDomain ? 'border-l-2 border-l-[#d4ff00]/40' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm truncate ${isDomain ? 'text-[#d4ff00]/80' : 'text-ink-50'}`}>
                            {isDomain ? '🔗 ' : ''}{h.title || h.name}
                          </div>
                          <div className="text-[10px] text-ink-500 font-mono mt-0.5 truncate">
                            {isDomain ? 'Website scraping · WHOIS · Wayback · Adverse media' : `${h.companyNumber}${h.address ? ` · ${h.address}` : ''}`}
                          </div>
                        </div>
                        {isDomain ? (
                          <span className="text-[9px] font-mono px-2 py-0.5 rounded-sm border bg-[#d4ff00]/10 text-[#d4ff00]/60 border-[#d4ff00]/20 shrink-0">Web research</span>
                        ) : h.status ? (
                          <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm border shrink-0 ${
                            h.status === 'active' ? 'bg-signal-clean/10 text-signal-clean border-signal-clean/30' : 'bg-white/5 text-ink-400 border-white/10'
                          }`}>{h.status}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected company card */}
        {selected && (
          <div className="flex items-center gap-4 p-5 border border-white/10 rounded-sm bg-ink-850 mb-10">
            <Avatar name={selected.title} type="company" size={40} />
            <div className="flex-1 min-w-0">
              <div className="text-base font-medium text-ink-50 truncate">{selected.title}</div>
              <div className="text-xs font-mono text-ink-500 mt-0.5">
                {selected.companyNumber}
                {selected.status && ` · ${selected.status}`}
                {` · ${jurisdiction.toUpperCase()}`}
              </div>
            </div>
            <button
              onClick={() => { setSelected(null); setQuery(''); setTimeout(() => searchRef.current?.focus(), 50); }}
              className="text-xs font-mono text-ink-500 hover:text-ink-50 border border-white/10 hover:border-white/30 px-3 py-1.5 rounded-sm transition-colors shrink-0"
            >
              ← Change
            </button>
          </div>
        )}

        {/* Tier cards — simplified for domain investigations */}
        {selected && jurisdiction === 'domain' ? (
          <div className="border border-[#d4ff00]/15 bg-[#d4ff00]/5 p-6 text-center">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#d4ff00]/50 mb-3">Web-sourced investigation</div>
            <p className="text-sm text-ink-400 mb-5 leading-relaxed">
              TraceGraph will research <strong className="text-ink-200">{selected.name || selected.title}</strong> from public web sources:
              website scraping, WHOIS, Wayback Machine, SEC filings, adverse media, and sanctions screening.
              Results appear in the same full investigation format — Overview, Network, Team, Timeline, IC Memo.
            </p>
            <button
              onClick={() => handleStart('STANDARD')}
              disabled={starting}
              className="px-8 py-3 bg-ink-50 text-ink-900 text-sm font-medium hover:bg-white transition-colors disabled:opacity-40"
            >
              {starting ? 'Starting...' : 'Start web investigation →'}
            </button>
          </div>
        ) : selected ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <TierCard tier="QUICK" badge="FREE" title="Quick scan" eta="30s – 2 min"
              bullets={['Target + direct directors', 'Max 200 entities', 'Companies House only', 'Basic profile']}
              onClick={() => handleStart('QUICK')} disabled={starting} />
            <TierCard tier="STANDARD" badge="DEFAULT" title="Standard" eta="2 – 10 min" recommended
              bullets={['Depth 2, smart filtering', 'Max 1,000 entities', 'All sources matched', 'Full anomaly detection']}
              onClick={() => handleStart('STANDARD')} disabled={starting} />
            <TierCard tier="DEEP" badge="PREMIUM" title="Deep investigation" eta="10 – 45 min" premium
              bullets={['Depth 3, no filtering', 'Max 5,000 entities', 'Enhanced entity resolution', 'Extra signals']}
              onClick={() => handleStart('DEEP')} disabled={starting} />
          </div>
        ) : null}

        {error && <p className="text-signal-critical text-sm mt-6">{error}</p>}

        {starting && (
          <div className="flex items-center gap-3 mt-6 text-sm text-ink-400 font-mono">
            <span className="w-4 h-4 border border-ink-500 border-t-ink-200 rounded-full animate-spin" />
            Starting investigation…
          </div>
        )}

        {/* Hint for unauthenticated */}
        {!user && selected && (
          <p className="text-[11px] font-mono text-ink-600 mt-6">
            You'll be asked to log in — your selection will be saved and the investigation will start automatically.
          </p>
        )}
      </div>
    </main>
  );
}

function TierCard({ tier, badge, title, eta, bullets, onClick, disabled, recommended, premium }: {
  tier: string; badge: string; title: string; eta: string; bullets: string[];
  onClick: () => void; disabled?: boolean; recommended?: boolean; premium?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`relative text-left p-7 bg-ink-900 hover:bg-ink-850 transition-all group disabled:opacity-50 ${
        recommended ? 'ring-1 ring-inset ring-white/15' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-6">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">
          /{tier === 'QUICK' ? '001' : tier === 'STANDARD' ? '002' : '003'}
        </span>
        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
          premium ? 'bg-signal-medium/10 text-signal-medium border-signal-medium/30'
            : recommended ? 'bg-ink-50/10 text-ink-50 border-white/20'
            : 'bg-signal-clean/10 text-signal-clean border-signal-clean/30'
        }`}>{badge}</span>
      </div>
      <h3 className="text-xl font-medium tracking-tight text-ink-50 mb-1">{title}</h3>
      <div className="text-[10px] font-mono text-ink-500 mb-5">est. {eta}</div>
      <ul className="space-y-2">
        {bullets.map((b) => (
          <li key={b} className="text-xs text-ink-300 flex gap-2">
            <span className="text-ink-500">›</span><span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 text-xs font-mono text-ink-400 group-hover:text-ink-50 transition-colors">
        {disabled ? 'Starting…' : 'Start →'}
      </div>
    </button>
  );
}
