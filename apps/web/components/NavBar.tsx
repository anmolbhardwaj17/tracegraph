'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from './AuthProvider';

interface Props {
  active?: 'dashboard' | 'compare' | 'watchlist' | 'leaderboard';
}

export function NavBar({ active }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
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

          {user ? (
            <div className="flex items-center gap-3 ml-2">
              <div className="w-6 h-6 rounded-full bg-ink-700 flex items-center justify-center text-[10px] font-bold text-ink-200">
                {(user.name || user.email)[0].toUpperCase()}
              </div>
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-sm border bg-white/5 text-ink-500 border-white/10 uppercase">
                {user.plan}
              </span>
              <button
                onClick={() => { logout(); router.push('/'); }}
                className="text-ink-500 hover:text-ink-50 transition-colors text-xs"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              href="/auth"
              className="ml-2 px-4 py-1.5 bg-ink-50 text-ink-900 rounded-sm text-xs font-medium hover:bg-white transition-colors"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
