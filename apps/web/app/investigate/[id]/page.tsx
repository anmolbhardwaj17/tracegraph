'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { GraphVisualization, GraphNode } from '../../../components/GraphVisualization';
import { ProgressView } from '../../../components/ProgressView';
import { RiskGauge, FindingRow } from '../../../components/RiskReport';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Finding {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  evidence: string[];
  affectedEntities: string[];
  recommendation: string;
}

interface Investigation {
  id: string;
  query: string;
  status: 'QUEUED' | 'FETCHING' | 'EXPANDING' | 'RESOLVING' | 'COMPLETE' | 'FAILED';
  progress?: any;
  counts?: { companies: number; people: number; addresses: number; edges: number };
  entities?: { company: any[]; person: any[]; address: any[] };
  matches?: any[];
  riskScore?: number;
  findings?: Finding[];
  error?: string;
}

type Tab = 'overview' | 'graph' | 'findings' | 'entities' | 'matches';

export default function InvestigatePage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<Investigation | null>(null);
  const [graph, setGraph] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [live, setLive] = useState({ entities: 0, edges: 0, depth: 0, apiCalls: 0, matches: 0 });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const socket: Socket = io(API, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('subscribe', { investigationId: id }));
    socket.on('progress_update', (p: any) =>
      setLive((prev) => ({
        ...prev,
        entities: p.entitiesDiscovered || prev.entities,
        edges: p.edgesCreated || prev.edges,
        depth: p.currentDepth || prev.depth,
        apiCalls: p.apiCallsMade || prev.apiCalls,
      })),
    );
    socket.on('entity_matched', () => setLive((p) => ({ ...p, matches: p.matches + 1 })));
    socket.on('expansion_complete', () => fetchData());

    async function fetchData() {
      try {
        const res = await fetch(`${API}/api/investigations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        if (json.status === 'COMPLETE') {
          // Fetch graph
          const gr = await fetch(`${API}/api/investigations/${id}/graph`);
          if (gr.ok) setGraph(await gr.json());
        }
        if (json.status !== 'COMPLETE' && json.status !== 'FAILED') {
          setTimeout(fetchData, 2000);
        }
      } catch (e: any) {
        setErr(e.message);
      }
    }
    fetchData();
    return () => { cancelled = true; socket.disconnect(); };
  }, [id]);

  if (err) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-lg font-medium">Error loading investigation</div>
          <div className="text-slate-500 mt-1 text-sm">{err}</div>
          <a href="/" className="inline-block mt-4 text-blue-600 hover:underline">Back to search</a>
        </div>
      </main>
    );
  }
  if (!data) return <LoadingSkeleton />;

  const isRunning = data.status !== 'COMPLETE' && data.status !== 'FAILED';

  if (isRunning) {
    return (
      <main className="min-h-screen px-6 py-8 max-w-4xl mx-auto">
        <a href="/" className="text-sm text-slate-500 hover:text-slate-900">← New search</a>
        <h1 className="text-2xl font-semibold mt-2 mb-1">{data.query}</h1>
        <p className="text-sm text-slate-500 mb-8">Investigation in progress</p>
        <ProgressView status={data.status} live={live} />
      </main>
    );
  }

  if (data.status === 'FAILED') {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-lg font-medium">Investigation failed</div>
          <div className="text-slate-600 mt-2 text-sm">{data.error || 'Unknown error'}</div>
          <a href="/" className="inline-block mt-6 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm">New search</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <a href="/" className="text-xs text-slate-500 hover:text-slate-900">TraceGraph</a>
            <h1 className="text-lg font-semibold truncate">{data.query}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ExportButton investigationId={id} />
            <a href="/" className="text-sm text-slate-600 hover:text-slate-900">New search</a>
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1">
            {(['overview', 'graph', 'findings', 'entities', 'matches'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'findings' && data.findings && data.findings.length > 0 && (
                  <span className="ml-1.5 text-xs text-slate-400">{data.findings.length}</span>
                )}
                {t === 'matches' && data.matches && data.matches.length > 0 && (
                  <span className="ml-1.5 text-xs text-slate-400">{data.matches.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'overview' && <OverviewTab data={data} />}
        {tab === 'graph' && <GraphTab graph={graph} onSelect={setSelectedNode} selected={selectedNode} />}
        {tab === 'findings' && <FindingsTab findings={data.findings || []} />}
        {tab === 'entities' && <EntitiesTab entities={data.entities} />}
        {tab === 'matches' && <MatchesTab matches={data.matches || []} />}
      </div>
    </main>
  );
}

function OverviewTab({ data }: { data: Investigation }) {
  const top3 = (data.findings || []).filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3);
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-center">
          <RiskGauge score={data.riskScore || 0} />
        </div>
        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          <StatCard label="Companies" value={data.counts?.companies || 0} />
          <StatCard label="People" value={data.counts?.people || 0} />
          <StatCard label="Addresses" value={data.counts?.addresses || 0} />
          <StatCard label="Connections" value={data.counts?.edges || 0} />
          <StatCard label="Findings" value={data.findings?.length || 0} accent />
          <StatCard label="Cross-source matches" value={data.matches?.length || 0} accent />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Top critical findings</h2>
        {top3.length === 0 ? (
          <EmptyState message="No critical findings detected." />
        ) : (
          <div className="space-y-3">
            {top3.map((f, i) => <FindingRow key={i} finding={f} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-5 ${accent ? 'border-slate-900' : 'border-slate-200'}`}>
      <div className="text-3xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function GraphTab({ graph, onSelect, selected }: { graph: any; onSelect: (n: GraphNode) => void; selected: GraphNode | null }) {
  if (!graph) return <LoadingSkeleton />;
  if (graph.nodes.length === 0) return <EmptyState message="No graph data available." />;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <div className={selected ? 'lg:col-span-3' : 'lg:col-span-4'}>
        <GraphVisualization
          nodes={graph.nodes}
          links={graph.links}
          height={680}
          onNodeClick={onSelect}
        />
      </div>
      {selected && (
        <aside className="bg-white border border-slate-200 rounded-xl p-5 h-fit sticky top-32">
          <button onClick={() => onSelect(null as any)} className="text-xs text-slate-400 hover:text-slate-900 float-right">×</button>
          <div className="text-xs uppercase tracking-wider text-slate-500">{selected.entityType}</div>
          <h3 className="font-semibold text-slate-900 mt-1 break-words">{selected.label}</h3>

          <dl className="mt-4 space-y-2 text-sm">
            <Field label="Connections" value={String(selected.degree)} />
            {selected.proximityScore && selected.proximityScore !== 'CLEAR' && (
              <Field label="Proximity" value={selected.proximityScore} />
            )}
            {selected.shellRisk && <Field label="Shell risk" value={selected.shellRisk} />}
            {selected.addressFlag && <Field label="Address flag" value={selected.addressFlag} />}
            {selected.hasMatch && <Field label="Sanctions" value="Match found" />}
          </dl>

          {selected.metadata && Object.keys(selected.metadata).length > 0 && (
            <details className="mt-4">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-900">Raw metadata</summary>
              <pre className="text-[10px] text-slate-600 mt-2 overflow-auto max-h-64 bg-slate-50 p-2 rounded">
                {JSON.stringify(selected.metadata, null, 2)}
              </pre>
            </details>
          )}
        </aside>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900 font-medium text-right">{value}</dd>
    </div>
  );
}

function FindingsTab({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return <EmptyState message="No risk signals detected." />;
  return (
    <div className="space-y-3">
      {findings.map((f, i) => <FindingRow key={i} finding={f} />)}
    </div>
  );
}

function EntitiesTab({ entities }: { entities?: { company: any[]; person: any[]; address: any[] } }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | 'company' | 'person' | 'address'>('all');
  if (!entities) return <EmptyState message="No entities found." />;

  const lists: Array<[string, any[]]> = [
    ['company', entities.company || []],
    ['person', entities.person || []],
    ['address', entities.address || []],
  ];
  const filtered = lists
    .filter(([t]) => type === 'all' || t === type)
    .map(([t, arr]) => [t, arr.filter((e) => e.label?.toLowerCase().includes(search.toLowerCase()))] as const);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
        >
          <option value="all">All types</option>
          <option value="company">Companies</option>
          <option value="person">People</option>
          <option value="address">Addresses</option>
        </select>
      </div>
      {filtered.map(([t, items]) => (
        items.length > 0 && (
          <section key={t} className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3">{t}s ({items.length})</h3>
            <ul className="divide-y divide-slate-100">
              {items.slice(0, 100).map((it) => (
                <li key={it.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <ProximityDot score={it.proximityScore} />
                    <span className="truncate">{it.label}</span>
                    {it.matches?.length > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                        {it.matches.length} match
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-400 font-mono shrink-0 ml-3 truncate max-w-[200px]">{it.entityId}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      ))}
    </div>
  );
}

function MatchesTab({ matches }: { matches: any[] }) {
  if (matches.length === 0) return <EmptyState message="No cross-source matches found." />;
  return (
    <div className="space-y-3">
      {matches.map((m: any) => (
        <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{m.reasons?.matchedName || m.matchedEntityId}</div>
              <div className="text-xs text-slate-500 mt-0.5">{m.sourceEntityType} · {m.sourceEntityId}</div>
              {m.reasons && (
                <div className="text-xs text-slate-600 mt-2 flex flex-wrap gap-2">
                  {m.reasons.exactName && <span className="px-1.5 py-0.5 rounded bg-slate-100">exact name</span>}
                  {m.reasons.phoneticMatch && <span className="px-1.5 py-0.5 rounded bg-slate-100">phonetic</span>}
                  {m.reasons.jaroWinkler && <span className="px-1.5 py-0.5 rounded bg-slate-100">JW {m.reasons.jaroWinkler}</span>}
                  {m.reasons.dobMatch && <span className="px-1.5 py-0.5 rounded bg-slate-100">DOB {m.reasons.dobMatch}</span>}
                  {m.reasons.nationality && <span className="px-1.5 py-0.5 rounded bg-slate-100">{m.reasons.nationality}</span>}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className={`text-xs px-2 py-0.5 rounded border ${
                m.source === 'opensanctions'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ'}
              </span>
              <span className={`text-xs text-white px-2 py-0.5 rounded ${
                m.confidence >= 75 ? 'bg-red-600' : m.confidence >= 50 ? 'bg-amber-500' : 'bg-slate-400'
              }`}>{m.confidence}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExportButton({ investigationId }: { investigationId: string }) {
  const [busy, setBusy] = useState(false);
  async function handleExport() {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/investigations/${investigationId}/export`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `tracegraph-${investigationId}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={handleExport}
      disabled={busy}
      className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? 'Exporting...' : 'Export PDF'}
    </button>
  );
}

function ProximityDot({ score }: { score?: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-600',
    HIGH: 'bg-orange-500',
    MEDIUM: 'bg-amber-400',
    LOW: 'bg-yellow-200',
    CLEAR: 'bg-green-300',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[score || 'CLEAR']}`} />;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-slate-500 text-sm">{message}</div>
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen px-6 py-12 max-w-5xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-6 w-48 bg-slate-200 rounded" />
        <div className="h-32 bg-slate-200 rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-24 bg-slate-200 rounded-xl" />
          <div className="h-24 bg-slate-200 rounded-xl" />
          <div className="h-24 bg-slate-200 rounded-xl" />
        </div>
      </div>
    </main>
  );
}
