'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { NavBar } from '../../../components/NavBar';
import { Avatar } from '../../../components/Avatar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  active:    { label: 'Active', color: 'text-signal-clean', dot: 'bg-signal-clean' },
  dissolved: { label: 'Dissolved', color: 'text-signal-critical', dot: 'bg-signal-critical' },
  resigned:  { label: 'Resigned', color: 'text-ink-500', dot: 'bg-ink-600' },
};

export default function PersonProfilePage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/persons/${id}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-4xl mx-auto px-8 py-12 animate-pulse space-y-6">
        <div className="h-20 bg-white/5 rounded-sm" />
        <div className="h-6 bg-white/5 rounded-sm w-1/3" />
        {[1,2,3,4].map(i => <div key={i} className="h-16 bg-white/5 rounded-sm" />)}
      </div>
    </main>
  );

  if (!data?.person) return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-4xl mx-auto px-8 py-24 text-center">
        <div className="text-ink-500 font-mono text-sm">Person not found</div>
        <Link href="/" className="text-xs text-ink-400 mt-4 block hover:text-ink-50">← Back to search</Link>
      </div>
    </main>
  );

  const { person, stats } = data;
  const track: any[] = person.trackRecord || [];
  const sig = person.signals || {};
  const hasDealRisk = sig.isPep || sig.isSanctioned || sig.isDisqualified || (sig.dissolvedCount || 0) >= 3;

  return (
    <main className="min-h-screen">
      <NavBar />

      <div className="max-w-4xl mx-auto px-8 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-start gap-5">
          <Avatar name={person.canonicalName} type="person" size={52} />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-medium tracking-tight text-ink-50">{person.canonicalName}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {person.nationality && (
                <span className="text-xs text-ink-500 font-mono">{person.nationality}</span>
              )}
              {person.dobYear && (
                <span className="text-xs text-ink-600 font-mono">b. {person.dobYear}</span>
              )}
              {sig.isPep && (
                <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-high/15 text-signal-high border-signal-high/30">PEP</span>
              )}
              {sig.isSanctioned && (
                <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-critical/15 text-signal-critical border-signal-critical/30">Sanctioned</span>
              )}
              {sig.isDisqualified && (
                <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-critical/15 text-signal-critical border-signal-critical/30">Disqualified</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-4 gap-px bg-white/5 border border-white/5">
          {[
            { label: 'Total companies', value: stats?.total ?? track.length },
            { label: 'Currently active', value: stats?.active ?? track.filter((a: any) => a.isActive).length, color: 'text-signal-clean' },
            { label: 'Dissolved', value: stats?.dissolved ?? track.filter((a: any) => a.isDissolved).length, color: (stats?.dissolved || 0) >= 3 ? 'text-signal-critical' : 'text-ink-50' },
            { label: 'Resigned', value: stats?.resigned ?? track.filter((a: any) => a.resignedOn && !a.isDissolved).length },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-ink-850 p-5">
              <div className={`text-2xl font-medium tabular-nums ${color || 'text-ink-50'}`}>{value}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {/* Deal risk warning */}
        {hasDealRisk && (
          <div className="border border-signal-high/30 bg-signal-high/5 px-5 py-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-signal-high mb-2">Deal risk flags</div>
            <ul className="space-y-1">
              {sig.isPep && <li className="text-xs text-ink-300">— Politically Exposed Person (PEP) — requires enhanced KYC</li>}
              {sig.isSanctioned && <li className="text-xs text-signal-critical">— Match on sanctions list — deal may not proceed without legal clearance</li>}
              {sig.isDisqualified && <li className="text-xs text-signal-critical">— Disqualified director — legally restricted from company management</li>}
              {(sig.dissolvedCount || 0) >= 3 && <li className="text-xs text-ink-300">— {sig.dissolvedCount} dissolved companies on record — warrants background investigation</li>}
            </ul>
          </div>
        )}

        {/* Track record */}
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            Track record — {track.length} compan{track.length === 1 ? 'y' : 'ies'}
          </div>

          {track.length === 0 ? (
            <div className="text-sm text-ink-500 py-8 text-center border border-white/5">
              No company appointments on record yet.
            </div>
          ) : (
            <div className="space-y-0 border border-white/5">
              {track.map((appt: any, i: number) => {
                const outcome = appt.isDissolved ? 'dissolved' : appt.resignedOn ? 'resigned' : 'active';
                const cfg = STATUS_CONFIG[outcome] || STATUS_CONFIG.active;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-4 px-5 py-4 border-b border-white/5 last:border-b-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Status dot */}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />

                    {/* Company info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/?q=${encodeURIComponent(appt.companyName)}`}
                          className="text-sm text-ink-100 hover:text-ink-50 transition-colors truncate"
                        >
                          {appt.companyName}
                        </Link>
                        {appt.companyJurisdiction && appt.companyJurisdiction !== 'gb' && (
                          <span className="text-[9px] font-mono text-ink-600 uppercase">{appt.companyJurisdiction}</span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-ink-600 mt-0.5">
                        {appt.role || 'Director'}
                        {appt.appointedOn && ` · Appointed ${new Date(appt.appointedOn).getFullYear()}`}
                        {appt.resignedOn && ` · Resigned ${new Date(appt.resignedOn).getFullYear()}`}
                      </div>
                    </div>

                    {/* Status badge */}
                    <span className={`text-[9px] font-mono uppercase tracking-wider shrink-0 ${cfg.color}`}>
                      {cfg.label}
                    </span>

                    {/* Link to investigation */}
                    {appt.investigationId && (
                      <Link
                        href={`/investigate/${appt.investigationId}/overview`}
                        className="text-[9px] font-mono text-ink-600 hover:text-ink-400 transition-colors shrink-0"
                      >
                        View →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Source note */}
        <div className="text-[10px] font-mono text-ink-700 pb-4">
          Data sourced from Companies House and other public registries via TraceGraph investigations.
          First seen: {person.firstSeenAt ? new Date(person.firstSeenAt).toLocaleDateString('en-GB') : 'Unknown'} ·
          Across {person.investigationCount} investigation{person.investigationCount !== 1 ? 's' : ''}.
        </div>

      </div>
    </main>
  );
}
