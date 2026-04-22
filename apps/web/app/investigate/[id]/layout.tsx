'use client';
import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Download, Eye, EyeOff, Sparkles } from 'lucide-react';
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

      {/* Content + Tracey sidebar flex layout */}
      <div className="flex min-h-[calc(100vh-140px)]">
        {/* Main content — shrinks when Tracey is open */}
        <div className={`flex-1 min-w-0 transition-all duration-300`}>
          <div className={`mx-auto px-8 py-6 ${traceyOpen ? 'max-w-5xl' : 'max-w-7xl'}`}>
            {children}
          </div>
        </div>

        {/* Tracey sidebar — fixed right panel */}
        {meta?.status === 'COMPLETE' && traceyOpen && (
          <div className="w-[400px] shrink-0 border-l border-white/5 bg-ink-900/95 backdrop-blur-sm">
            <div className="sticky top-0 h-screen flex flex-col">
              <TraceyChat investigationId={id} companyName={meta?.companyName || meta?.query} embedded onClose={() => setTraceyOpen(false)} />
            </div>
          </div>
        )}
      </div>

      {/* Glowing orb — bottom right when Tracey is closed */}
      {meta?.status === 'COMPLETE' && !traceyOpen && (
        <button
          onClick={() => setTraceyOpen(true)}
          className="fixed bottom-8 right-8 z-50 group"
        >
          {/* Outer glow rings */}
          <div className="absolute inset-0 w-14 h-14 rounded-full bg-violet-500/20 animate-ping" style={{ animationDuration: '3s' }} />
          <div className="absolute -inset-1 w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 blur-md animate-pulse" style={{ animationDuration: '2s' }} />
          {/* Orb */}
          <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30 flex items-center justify-center transition-transform group-hover:scale-110">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          {/* Label on hover */}
          <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-ink-800 text-ink-200 text-[10px] font-mono px-3 py-1.5 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
            Ask Tracey AI
          </span>
        </button>
      )}
    </main>
  );
}
