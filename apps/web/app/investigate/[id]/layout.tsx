'use client';
import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Download, Eye, EyeOff } from 'lucide-react';
import { Avatar } from '../../../components/Avatar';
import { NavBar } from '../../../components/NavBar';
import { TraceyChat } from '../../../components/TraceyChat';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'graph', label: 'Graph' },
  { key: 'locations', label: 'Locations' },
  { key: 'ubo', label: 'UBO' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'findings', label: 'Findings' },
  { key: 'entities', label: 'Entities' },
  { key: 'matches', label: 'Matches' },
];

export default function InvestigationLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const id = params?.id as string;
  const [meta, setMeta] = useState<any>(null);
  const [watched, setWatched] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [traceyOpen, setTraceyOpen] = useState(false);

  // Detect if we're on a tab sub-route or the base page (progress view)
  const pathParts = pathname.split('/');
  const currentTab = pathParts.length > 3 ? pathParts[3] : null;
  const isTabRoute = currentTab && TABS.some((t) => t.key === currentTab);

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/api/investigations/${id}/meta`)
      .then((r) => r.ok ? r.json() : null)
      .then((m) => {
        setMeta(m);
        if (m?.rootCompanyNumber) {
          fetch(`${API}/api/watchlist/${m.rootCompanyNumber}`)
            .then((r) => r.json())
            .then((d) => setWatched(d.watched))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, [id, isTabRoute]);

  // If on base page (progress/loading), render children without tab chrome
  if (!isTabRoute) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-screen">
      <NavBar />

      {/* Investigation header */}
      <header className="sticky top-[57px] z-20 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-4">
            {meta && <Avatar name={meta.companyName || meta.query} type="company" size={28} />}
            <h1 className="text-base font-medium tracking-tight text-ink-50 truncate">
              {meta?.companyName || meta?.query || 'Loading...'}
            </h1>
            {meta?.tier && (
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border ${
                meta.tier === 'DEEP' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
                meta.tier === 'QUICK' ? 'bg-signal-clean/15 text-signal-clean border-signal-clean/30' :
                'bg-white/10 text-ink-50 border-white/20'
              }`}>
                {meta.tier === 'DEEP' ? 'Deep investigation' : meta.tier === 'QUICK' ? 'Quick scan' : 'Standard'}
              </span>
            )}
            {meta?.jurisdiction && meta.jurisdiction !== 'gb' && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border bg-signal-medium/10 text-signal-medium border-signal-medium/20">
                {meta.jurisdiction.toUpperCase()} - Basic
              </span>
            )}
            {meta?.jurisdiction === 'gb' && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border bg-signal-clean/10 text-signal-clean border-signal-clean/20">
                UK - Full
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            {meta?.riskScore != null && (
              <div className="flex items-center gap-2">
                <span className={`text-lg font-medium tabular-nums ${
                  meta.riskScore >= 75 ? 'text-signal-critical' :
                  meta.riskScore >= 50 ? 'text-signal-high' :
                  meta.riskScore >= 25 ? 'text-signal-medium' :
                  'text-signal-clean'
                }`}>{meta.riskScore}</span>
                <span className="text-[10px] font-mono text-ink-500">/ 100</span>
              </div>
            )}
            <button
              onClick={() => {
                if (watched) {
                  fetch(`${API}/api/watchlist/${meta?.rootCompanyNumber}`, { method: 'DELETE' })
                    .then(() => setWatched(false));
                } else {
                  fetch(`${API}/api/watchlist`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      companyNumber: meta?.rootCompanyNumber,
                      companyName: meta?.companyName,
                      investigationId: id,
                      riskScore: meta?.riskScore,
                    }),
                  }).then(() => setWatched(true));
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-sm text-[10px] font-mono uppercase tracking-wider transition-colors ${
                watched
                  ? 'border-signal-clean/30 text-signal-clean hover:border-white/30'
                  : 'border-white/10 text-ink-400 hover:text-ink-50 hover:border-white/30'
              }`}
            >
              {watched ? <Eye size={12} /> : <EyeOff size={12} />}
              {watched ? 'Watching' : 'Watch'}
            </button>
            <button
              disabled={exporting}
              onClick={() => {
                setExporting(true);
                const url = `${API}/api/investigations/${id}/export`;
                fetch(url, { method: 'POST' })
                  .then((r) => r.blob())
                  .then((blob) => {
                    const name = (meta?.companyName || meta?.rootCompanyNumber || id).replace(/[^a-zA-Z0-9]/g, '_');
                    const ts = new Date().toISOString().slice(0, 10);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${name}_${ts}.pdf`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  })
                  .finally(() => setExporting(false));
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors disabled:text-ink-600 disabled:border-white/5"
            >
              {exporting ? (
                <>
                  <div className="w-3 h-3 border border-ink-400 border-t-transparent rounded-full animate-spin" />
                  Exporting
                </>
              ) : (
                <>
                  <Download size={12} />
                  Export PDF
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-8">
          <nav className="flex gap-6 overflow-x-auto">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/investigate/${id}/${t.key}`}
                className={`relative py-3 text-xs font-mono uppercase tracking-[0.15em] transition-colors whitespace-nowrap ${
                  currentTab === t.key ? 'text-ink-50' : 'text-ink-500 hover:text-ink-300'
                }`}
              >
                {t.label}
                {currentTab === t.key && <span className="absolute bottom-0 inset-x-0 h-px bg-ink-50" />}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-8 py-6">
        {children}
      </div>

      {/* Tracey sidebar — renders via React portal on document.body */}
      {meta?.status === 'COMPLETE' && traceyOpen && (
        <TraceyChat investigationId={id} companyName={meta?.companyName || meta?.query} embedded onClose={() => setTraceyOpen(false)} />
      )}

      {/* Tracey AI orb — bottom right */}
      {meta?.status === 'COMPLETE' && !traceyOpen && (
        <button
          onClick={() => setTraceyOpen(true)}
          className="fixed bottom-8 right-8 z-50 group"
        >
          {/* Outer glow pulse */}
          <div className="absolute -inset-4 rounded-full animate-pulse" style={{ animationDuration: '3s', background: 'radial-gradient(circle, rgba(200,255,0,0.12) 0%, transparent 70%)' }} />
          <div className="absolute -inset-2 rounded-full animate-ping opacity-20" style={{ animationDuration: '4s', background: 'radial-gradient(circle, rgba(200,255,0,0.15) 0%, transparent 60%)' }} />

          {/* The orb */}
          <div className="relative w-[60px] h-[60px] rounded-full transition-transform group-hover:scale-110 overflow-hidden" style={{
            background: 'radial-gradient(circle at 38% 32%, rgba(210,255,40,0.5) 0%, rgba(140,200,0,0.2) 25%, rgba(60,80,0,0.2) 50%, #0c0e08 85%)',
            boxShadow: '0 0 35px rgba(200,255,0,0.18), 0 0 70px rgba(200,255,0,0.06), inset 0 -8px 20px rgba(200,255,0,0.08)',
          }}>
            {/* Glass highlight — top left crescent */}
            <div className="absolute top-[6px] left-[10px] w-[22px] h-[10px] rounded-full bg-white/20 blur-[3px] rotate-[-15deg]" />

            {/* Slow rotating inner shimmer */}
            <div className="absolute inset-[3px] rounded-full" style={{
              animation: 'orbSpin 10s linear infinite',
              background: 'conic-gradient(from 0deg, transparent 0%, rgba(200,255,0,0.08) 20%, transparent 40%, rgba(180,255,50,0.06) 60%, transparent 80%, rgba(220,255,0,0.05) 100%)',
            }} />

            {/* Depth ring — inner shadow */}
            <div className="absolute inset-[2px] rounded-full" style={{ boxShadow: 'inset 0 4px 12px rgba(0,0,0,0.4), inset 0 -2px 8px rgba(200,255,0,0.05)' }} />

            {/* Eyes */}
            <div className="absolute inset-0 flex items-center justify-center gap-[11px] pt-[1px]">
              <div className="w-[6px] h-[6px] rounded-full bg-[#d4ff00]" style={{
                boxShadow: '0 0 8px rgba(212,255,0,0.9), 0 0 16px rgba(212,255,0,0.4)',
                animation: 'blink 2.5s ease-in-out infinite, orbLook 4s ease-in-out infinite',
              }} />
              <div className="w-[6px] h-[6px] rounded-full bg-[#d4ff00]" style={{
                boxShadow: '0 0 8px rgba(212,255,0,0.9), 0 0 16px rgba(212,255,0,0.4)',
                animation: 'blink 2.5s ease-in-out infinite 0.1s, orbLook 4s ease-in-out infinite 0.1s',
              }} />
            </div>
          </div>

          {/* Tooltip */}
          <span className="absolute -top-9 left-1/2 -translate-x-1/2 bg-[#111] text-[#d4ff00]/60 text-[10px] font-mono px-3 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity border border-[#d4ff00]/10 shadow-lg">
            Ask Tracey
          </span>

          <style jsx>{`
            @keyframes blink {
              0%,38%,42%,75%,79%,100% { transform: scaleY(1); }
              40% { transform: scaleY(0.1); }
              77% { transform: scaleY(0.1); }
            }
            @keyframes orbLook {
              0%,20% { transform: translateX(0); }
              25%,40% { transform: translateX(2px); }
              45%,60% { transform: translateX(-1.5px) translateY(0.5px); }
              65%,80% { transform: translateX(1px) translateY(-0.5px); }
              85%,100% { transform: translateX(0); }
            }
            @keyframes orbSpin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
          `}</style>
        </button>
      )}
    </main>
  );
}
