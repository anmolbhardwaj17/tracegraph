'use client';
import { useEffect, useState } from 'react';
import { Avatar } from '../Avatar';
import { API } from './shared';

interface DatasetStats {
  sanctions: number;
  offshoreEntities: number;
  offshoreOfficers: number;
  offshoreIntermediaries: number;
}

interface Props {
  matches: any[];
  counts?: { companies: number; people: number; addresses: number };
}

export function MatchesTab({ matches, counts }: Props) {
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [reasonsOpen, setReasonsOpen] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/datasets/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  if (matches.length === 0) {
    const screened = (counts?.companies || 0) + (counts?.people || 0);
    const sanctionsCount = stats?.sanctions ?? 0;
    const offshoreCount = (stats?.offshoreEntities ?? 0) + (stats?.offshoreOfficers ?? 0);

    return (
      <div className="space-y-8">
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Matches screening</div>
          <div className="border border-white/5 bg-ink-850 p-8">
            <h2 className="text-2xl font-medium text-ink-50 mb-2">No matches found.</h2>
            <p className="text-sm text-ink-300 leading-relaxed max-w-2xl">
              We screened <span className="text-ink-50 font-medium">{screened}</span> entities in this network against{' '}
              <span className="text-ink-50 font-medium">{sanctionsCount}</span> OpenSanctions records and{' '}
              <span className="text-ink-50 font-medium">{offshoreCount}</span> ICIJ OffshoreLeaks records currently loaded
              in the local database.
            </p>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border border-white/5">
              <Stat label="Entities screened" value={String(screened)} />
              <Stat label="OpenSanctions" value={String(sanctionsCount)} />
              <Stat label="ICIJ entities" value={String(stats?.offshoreEntities ?? 0)} />
              <Stat label="ICIJ officers" value={String(stats?.offshoreOfficers ?? 0)} />
            </div>
            <div className="mt-6 p-4 border border-white/5 bg-ink-900">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Note</div>
              <p className="text-xs text-ink-300 leading-relaxed">
                This sample dataset is intentionally small for development. Production deployments would ingest the full
                datasets (~200k OpenSanctions entities, ~800k ICIJ records) for comprehensive screening. To load the full
                data, see <span className="font-mono text-ink-400">apps/api/data/README.md</span>.
              </p>
            </div>
            <button
              onClick={() => setReasonsOpen(!reasonsOpen)}
              className="mt-4 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 transition-colors"
            >
              {reasonsOpen ? '−' : '+'} Why a match might still be missed
            </button>
            {reasonsOpen && (
              <ul className="mt-3 space-y-1.5 text-xs text-ink-300">
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>The director or beneficial owner uses a name variant our fuzzy matcher couldn't catch</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>The company is screened against names only, not numbers/identifiers or aliases</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>Names ingested with non-Latin characters need additional Unicode normalization</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>Phonetic matching uses simplified Double Metaphone · full DM catches more variants</span></li>
                <li className="flex gap-2"><span className="text-ink-500">›</span><span>The trigram pre-filter threshold is set to 0.15 · very loose names may still fall outside</span></li>
              </ul>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {matches.map((m: any) => (
        <div key={m.id} className="border border-white/5 bg-ink-850 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 min-w-0">
              <Avatar name={m.reasons?.matchedName || m.matchedEntityId} type={m.sourceEntityType} size={44} />
              <div className="min-w-0">
                <div className="font-medium text-ink-50">{m.reasons?.matchedName || m.matchedEntityId}</div>
                <div className="text-xs text-ink-500 font-mono mt-1">{m.sourceEntityType} · {m.sourceEntityId}</div>
                {m.reasons && (
                  <div className="text-xs mt-3 flex flex-wrap gap-1.5">
                    {m.reasons.exactName && <Chip>exact name</Chip>}
                    {m.reasons.phoneticMatch && <Chip>phonetic</Chip>}
                    {m.reasons.jaroWinkler && <Chip>JW {m.reasons.jaroWinkler}</Chip>}
                    {m.reasons.dobMatch && <Chip>DOB {m.reasons.dobMatch}</Chip>}
                    {m.reasons.nationality && <Chip>{m.reasons.nationality}</Chip>}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border ${
                m.source === 'opensanctions'
                  ? 'bg-signal-critical/10 text-signal-critical border-signal-critical/30'
                  : 'bg-signal-high/10 text-signal-high border-signal-high/30'
              }`}>
                {m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ'}
              </span>
              <span className={`text-xs font-mono px-2 py-1 rounded-sm ${
                m.confidence >= 75 ? 'bg-signal-critical text-ink-900' :
                m.confidence >= 50 ? 'bg-signal-medium text-ink-900' :
                'bg-ink-700 text-ink-300'
              }`}>{m.confidence}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-sm bg-white/5 text-ink-300 font-mono text-[10px] border border-white/5">{children}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-850 p-4">
      <div className="text-2xl font-medium text-ink-50 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono">{label}</div>
    </div>
  );
}
