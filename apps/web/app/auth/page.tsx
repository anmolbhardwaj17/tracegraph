'use client';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../components/AuthProvider';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, signup, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get('redirect') || '/dashboard';

  // Already logged in
  if (user) {
    router.push(redirect);
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
      router.push(redirect);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-3 mb-10">
          <div className="w-8 h-8 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-sm font-bold">T</div>
          <span className="text-lg tracking-tight text-ink-50 font-medium">TraceGraph</span>
        </Link>

        {/* Title */}
        <h1 className="text-xl font-medium text-ink-50 text-center mb-2">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-sm text-ink-500 text-center mb-8">
          {mode === 'login' ? 'Log in to continue your investigations' : '5 free investigations per month. No credit card required.'}
        </p>

        {/* Google OAuth placeholder */}
        <button
          disabled
          className="w-full py-3 px-4 border border-white/10 rounded-sm text-sm text-ink-400 flex items-center justify-center gap-3 mb-4 opacity-50 cursor-not-allowed"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google (coming soon)
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] font-mono text-ink-600 uppercase">or</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-1.5 block">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-600 focus:border-white/20 focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-1.5 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="w-full px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-600 focus:border-white/20 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-1.5 block">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
              required
              minLength={mode === 'signup' ? 6 : undefined}
              className="w-full px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-600 focus:border-white/20 focus:outline-none"
            />
          </div>

          {error && (
            <div className="text-signal-critical text-xs bg-signal-critical/10 border border-signal-critical/20 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-ink-50 text-ink-900 rounded-sm font-medium text-sm hover:bg-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        {/* Toggle */}
        <p className="text-center text-sm text-ink-500 mt-6">
          {mode === 'login' ? (
            <>Don&apos;t have an account? <button onClick={() => { setMode('signup'); setError(''); }} className="text-ink-50 hover:underline">Sign up free</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode('login'); setError(''); }} className="text-ink-50 hover:underline">Log in</button></>
          )}
        </p>

        {/* Plan info */}
        {mode === 'signup' && (
          <div className="mt-8 border border-white/5 rounded-sm p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Free plan includes</div>
            <ul className="space-y-2 text-xs text-ink-400">
              <li className="flex gap-2"><span className="text-signal-clean">-</span> 5 investigations per month</li>
              <li className="flex gap-2"><span className="text-signal-clean">-</span> Full 25+ source intelligence</li>
              <li className="flex gap-2"><span className="text-signal-clean">-</span> PDF report export</li>
              <li className="flex gap-2"><span className="text-signal-clean">-</span> PEP + sanctions screening</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
