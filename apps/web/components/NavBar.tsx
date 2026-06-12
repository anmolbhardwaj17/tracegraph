'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from './AuthProvider';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

interface Props {
  active?: 'dashboard' | 'compare' | 'watchlist' | 'leaderboard';
}

export function NavBar({ active }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [alertCount, setAlertCount] = useState(0);

  const current = active || (
    pathname.startsWith('/dashboard') ? 'dashboard' :
    pathname.startsWith('/pipeline') ? 'pipeline' :
    pathname.startsWith('/compare') ? 'compare' :
    pathname.startsWith('/watchlist') ? 'watchlist' :
    pathname.startsWith('/alerts') ? 'alerts' :
    pathname.startsWith('/team') ? 'team' : undefined
  );

  useEffect(() => {
    fetch(`${API}/api/watchlist/alerts/count`)
      .then(r => r.json())
      .then(d => setAlertCount(d.count || 0))
      .catch(() => {});
    // Refresh count every 3 minutes
    const interval = setInterval(() => {
      fetch(`${API}/api/watchlist/alerts/count`)
        .then(r => r.json())
        .then(d => setAlertCount(d.count || 0))
        .catch(() => {});
    }, 180_000);
    return () => clearInterval(interval);
  }, []);

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
          {link('/pipeline', 'Pipeline', 'pipeline')}
          {link('/compare', 'Compare', 'compare')}
          {link('/watchlist', 'Monitor', 'watchlist')}
          {link('/team', 'Team', 'team')}

          {/* Alert bell */}
          <Link href="/alerts" className="relative group">
            <Bell size={15} className={`transition-colors ${current === 'alerts' ? 'text-ink-50' : 'text-ink-500 group-hover:text-ink-300'}`} />
            {alertCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-signal-critical text-[8px] font-mono font-bold text-white flex items-center justify-center px-0.5">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </Link>

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
