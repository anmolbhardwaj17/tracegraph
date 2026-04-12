'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  active?: 'dashboard' | 'compare' | 'watchlist' | 'leaderboard';
}

export function NavBar({ active }: Props) {
  const pathname = usePathname();
  const current = active || (
    pathname.startsWith('/dashboard') ? 'dashboard' :
    pathname.startsWith('/compare') ? 'compare' :
    pathname.startsWith('/watchlist') ? 'watchlist' :
    pathname.startsWith('/leaderboard') ? 'leaderboard' : undefined
  );

  const link = (href: string, label: string, key: string) => (
    <Link
      href={href}
      className={`hover:text-ink-50 transition-colors ${current === key ? 'text-ink-50' : ''}`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
      <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
          <span className="text-sm tracking-tight text-ink-50 font-medium">TraceGraph</span>
        </Link>
        <div className="flex items-center gap-6 text-[13px] text-ink-300">
          {link('/dashboard', 'Dashboard', 'dashboard')}
          {link('/compare', 'Compare', 'compare')}
          {link('/watchlist', 'Watchlist', 'watchlist')}
          {link('/leaderboard', 'Leaderboard', 'leaderboard')}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
