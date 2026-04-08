'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Investigation {
  id: string;
  query: string;
  status: 'QUEUED' | 'FETCHING' | 'EXPANDING' | 'COMPLETE' | 'FAILED';
  progress?: {
    entitiesDiscovered: number;
    edgesCreated: number;
    apiCallsMade: number;
    currentDepth: number;
  };
  counts?: { companies: number; people: number; addresses: number; edges: number };
  entities?: { company: any[]; person: any[]; address: any[] };
  error?: string;
}

export default function InvestigatePage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<Investigation | null>(null);
  const [live, setLive] = useState({ entities: 0, edges: 0, depth: 0, apiCalls: 0 });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const socket: Socket = io(API, { transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('subscribe', { investigationId: id }));
    socket.on('progress_update', (p: any) => {
      setLive({
        entities: p.entitiesDiscovered,
        edges: p.edgesCreated,
        depth: p.currentDepth,
        apiCalls: p.apiCallsMade,
      });
    });
    socket.on('expansion_complete', () => fetchData());

    async function fetchData() {
      try {
        const res = await fetch(`${API}/api/investigations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        if (json.progress) {
          setLive({
            entities: json.progress.entitiesDiscovered || 0,
            edges: json.progress.edgesCreated || 0,
            depth: json.progress.currentDepth || 0,
            apiCalls: json.progress.apiCallsMade || 0,
          });
        }
        if (json.status !== 'COMPLETE' && json.status !== 'FAILED') {
          setTimeout(fetchData, 2000);
        }
      } catch (e: any) {
        setErr(e.message);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [id]);

  if (err) return <main className="p-10 text-red-600">{err}</main>;
  if (!data) return <main className="p-10 text-slate-500">Loading...</main>;

  const isExpanding = data.status === 'QUEUED' || data.status === 'FETCHING' || data.status === 'EXPANDING';

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <a href="/" className="text-sm text-blue-600 hover:underline">← New search</a>
      <h1 className="text-3xl font-bold mt-2">Investigation</h1>
      <p className="text-slate-500 mt-1">Query: {data.query}</p>
      <StatusBadge status={data.status} />

      {isExpanding && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
            <h2 className="text-lg font-semibold">Expanding network…</h2>
          </div>
          <div className="grid grid-cols-4 gap-4 text-center">
            <Stat label="Entities" value={live.entities} />
            <Stat label="Connections" value={live.edges} />
            <Stat label="Depth" value={live.depth} />
            <Stat label="API calls" value={live.apiCalls} />
          </div>
        </section>
      )}

      {data.status === 'FAILED' && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {data.error || 'Investigation failed'}
        </div>
      )}

      {data.counts && data.status === 'COMPLETE' && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Results</h2>
          <div className="grid grid-cols-4 gap-4 text-center mb-6">
            <Stat label="Companies" value={data.counts.companies} />
            <Stat label="People" value={data.counts.people} />
            <Stat label="Addresses" value={data.counts.addresses} />
            <Stat label="Connections" value={data.counts.edges} />
          </div>

          <EntityList title="Companies" items={data.entities?.company || []} color="text-blue-700" />
          <EntityList title="People" items={data.entities?.person || []} color="text-green-700" />
          <EntityList title="Addresses" items={data.entities?.address || []} color="text-slate-700" />
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    QUEUED: 'bg-slate-100 text-slate-700',
    FETCHING: 'bg-blue-100 text-blue-700',
    EXPANDING: 'bg-blue-100 text-blue-700',
    COMPLETE: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium ${colors[status] || ''}`}>
      {status}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function EntityList({ title, items, color }: { title: string; items: any[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className={`text-sm font-semibold mb-2 ${color}`}>{title} ({items.length})</h3>
      <ul className="space-y-1 text-sm">
        {items.slice(0, 50).map((it) => (
          <li key={it.id} className="flex justify-between border-b border-slate-100 py-1">
            <span>{it.label}</span>
            <span className="text-slate-400 text-xs">
              {it.metadata?.companyCount ? `${it.metadata.companyCount} cos` : it.entityId}
            </span>
          </li>
        ))}
        {items.length > 50 && <li className="text-slate-400 text-xs">…and {items.length - 50} more</li>}
      </ul>
    </div>
  );
}
