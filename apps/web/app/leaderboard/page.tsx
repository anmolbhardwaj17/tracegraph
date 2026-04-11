'use client';
import Link from 'next/link';

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
            <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-ink-300">
            <Link href="/dashboard" className="hover:text-ink-50 transition-colors">Dashboard</Link>
            <Link href="/compare" className="hover:text-ink-50 transition-colors">Compare</Link>
            <Link href="/watchlist" className="hover:text-ink-50 transition-colors">Watchlist</Link>
            <Link href="/leaderboard" className="text-ink-50">Leaderboard</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-8 py-10">
        <h1 className="text-2xl font-medium text-ink-50 mb-1">UK's Riskiest Companies</h1>
        <p className="text-sm text-ink-500 font-mono mb-8">Public investigations ranked by risk score. Updated as new investigations complete.</p>

        {/* Coming soon banner */}
        <div className="border border-signal-medium/20 bg-signal-medium/5 px-5 py-4 mb-8">
          <div className="text-sm text-signal-medium font-medium mb-1">Coming soon</div>
          <div className="text-xs text-ink-400">This leaderboard will show anonymized risk scores from public investigations once enough data is available.</div>
        </div>

        {/* Placeholder table */}
        <div className="border border-white/5">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500 items-center">
            <div className="col-span-1">#</div>
            <div className="col-span-4">Company</div>
            <div className="col-span-2">Risk score</div>
            <div className="col-span-3">Top finding</div>
            <div className="col-span-2 text-right">Date</div>
          </div>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 px-5 py-4 border-b border-white/5 last:border-b-0 items-center animate-pulse">
              <div className="col-span-1 text-sm font-mono text-ink-600">{i + 1}</div>
              <div className="col-span-4">
                <div className="h-3 bg-white/5 rounded-sm" style={{ width: `${60 + Math.random() * 30}%` }} />
              </div>
              <div className="col-span-2">
                <div className="h-3 bg-white/5 rounded-sm w-12" />
              </div>
              <div className="col-span-3">
                <div className="h-3 bg-white/5 rounded-sm" style={{ width: `${40 + Math.random() * 40}%` }} />
              </div>
              <div className="col-span-2">
                <div className="h-3 bg-white/5 rounded-sm w-16 ml-auto" />
              </div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mt-12 space-y-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ How it works</div>
          <p className="text-sm text-ink-300 leading-relaxed max-w-2xl">
            Companies appear here when their investigations are made public by the investigating user.
            Scores are based on 30+ automated risk detectors analyzing public Companies House data,
            global sanctions lists (4.1M+ entities), and offshore entity databases (770K+ records).
          </p>
          <div className="border border-white/5 bg-ink-850 p-6">
            <div className="text-sm text-ink-50 font-medium mb-2">Want to contribute?</div>
            <p className="text-xs text-ink-400 mb-4">Investigate a company and choose to make your report public.</p>
            <Link href="/" className="px-5 py-2.5 bg-ink-50 text-ink-900 rounded-sm text-sm font-medium hover:bg-white transition-colors inline-block">
              Investigate a company
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
