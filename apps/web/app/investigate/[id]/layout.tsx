'use client';
import { useEffect, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { Avatar } from '../../../components/Avatar';

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

  // Detect if we're on a tab sub-route or the base page (progress view)
  const pathParts = pathname.split('/');
  const currentTab = pathParts.length > 3 ? pathParts[3] : null;
  const isTabRoute = currentTab && TABS.some((t) => t.key === currentTab);

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/api/investigations/${id}/meta`)
      .then((r) => r.ok ? r.json() : null)
      .then(setMeta)
      .catch(() => {});
  }, [id]);

  // If on base page (progress/loading), render children without tab chrome
  if (!isTabRoute) {
    return <>{children}</>;
  }

  return (
    <main className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
            <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-ink-300">
            <Link href="/dashboard" className="hover:text-ink-50 transition-colors hidden sm:block">Dashboard</Link>
            <Link href="/compare" className="hover:text-ink-50 transition-colors hidden sm:block">Compare</Link>
            <Link href="/watchlist" className="hover:text-ink-50 transition-colors hidden sm:block">Watchlist</Link>
          </div>
        </div>
      </nav>

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
                const url = `${API}/api/investigations/${id}/export`;
                fetch(url, { method: 'POST' })
                  .then((r) => r.blob())
                  .then((blob) => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `tracegraph-${meta?.companyName || id}.pdf`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
            >
              <Download size={12} />
              Export PDF
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

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-8 py-6">
        {children}
      </div>
    </main>
  );
}
