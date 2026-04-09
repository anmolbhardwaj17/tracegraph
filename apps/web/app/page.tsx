'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface RecentInvestigation {
  id: string;
  query: string;
  status: string;
  createdAt: string;
  riskScore?: number;
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentInvestigation[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch(`${API}/api/investigations`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setRecent(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/investigations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      router.push(`/investigate/${data.id}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-4xl mx-auto px-6 pt-24 pb-16">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-block text-xs uppercase tracking-widest text-slate-500 mb-4">TraceGraph</div>
          <h1 className="text-5xl font-semibold tracking-tight text-slate-900 mb-3">
            Corporate intelligence,
            <br />
            <span className="text-slate-400">at the speed of curiosity.</span>
          </h1>
          <p className="text-slate-600 max-w-xl mx-auto">
            Autonomous investigations from public data sources. Map ownership networks,
            surface risk signals, detect shell company patterns.
          </p>
        </div>

        {/* Search */}
        <form onSubmit={submit} className="relative max-w-2xl mx-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter a UK company name or number..."
            className="w-full px-5 py-4 pr-32 text-lg rounded-xl border border-slate-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900"
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-2 top-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg font-medium text-sm hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Starting…' : 'Investigate →'}
          </button>
        </form>
        {error && <p className="text-red-600 text-sm mt-3 text-center">{error}</p>}

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-16">
          <Feature
            icon="◇"
            title="Multi-source intelligence"
            description="UK Companies House, OpenSanctions, and ICIJ OffshoreLeaks unified into one network view."
          />
          <Feature
            icon="◯"
            title="Graph analysis"
            description="Recursive expansion through directors, ownership, and addresses with cycle detection."
          />
          <Feature
            icon="△"
            title="Risk detection"
            description="Shell company signals, sanctions proximity, temporal anomalies, and circular ownership."
          />
        </div>

        {/* Recent investigations */}
        {recent.length > 0 && (
          <section className="mt-16">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Recent investigations</h2>
            <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <a
                    href={`/investigate/${inv.id}`}
                    className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{inv.query}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {new Date(inv.createdAt).toLocaleString()} · {inv.status}
                      </div>
                    </div>
                    {inv.riskScore !== undefined && <RiskPill score={inv.riskScore} />}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function Feature({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors">
      <div className="text-2xl text-slate-400 mb-2">{icon}</div>
      <h3 className="font-semibold text-sm text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
    </div>
  );
}

function RiskPill({ score }: { score: number }) {
  const color = score >= 60 ? 'bg-red-600' : score >= 30 ? 'bg-amber-500' : 'bg-emerald-500';
  return <span className={`text-xs text-white px-2 py-0.5 rounded ${color}`}>{score}</span>;
}
