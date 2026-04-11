'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { ProgressView } from '../../../components/ProgressView';
import { Avatar } from '../../../components/Avatar';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function NavBar() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
          <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
        </Link>
        <div className="flex items-center gap-6 text-sm text-ink-300">
          <Link href="/dashboard" className="hover:text-ink-50 transition-colors hidden sm:block">Dashboard</Link>
          <Link href="/compare" className="hover:text-ink-50 transition-colors hidden sm:block">Compare</Link>
          <Link href="/watchlist" className="hover:text-ink-50 transition-colors hidden sm:block">Watchlist</Link>
        </div>
      </div>
    </nav>
  );
}

export default function InvestigatePage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [data, setData] = useState<any>(null);
  const [live, setLive] = useState({ entities: 0, edges: 0, depth: 0, apiCalls: 0, matches: 0 });
  const [resolution, setResolution] = useState<{ processed: number; total: number; matches: number } | null>(null);
  const [scoringStep, setScoringStep] = useState<{ step: string; detail?: string } | null>(null);
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
    socket.on('resolution_progress', (p: any) => setResolution({ processed: p.processed, total: p.total, matches: p.matches }));
    socket.on('resolution_complete', () => setResolution(null));
    socket.on('scoring_step', (p: any) => setScoringStep({ step: p.step, detail: p.detail }));
    socket.on('status_changed', (p: any) => {
      setData((prev: any) => prev ? { ...prev, status: p.status } : prev);
    });
    socket.on('expansion_complete', () => { setScoringStep(null); fetchData(); });

    async function fetchData() {
      try {
        const [metaRes, fullRes] = await Promise.all([
          fetch(`${API}/api/investigations/${id}/meta`),
          fetch(`${API}/api/investigations/${id}`).catch(() => null),
        ]);
        if (!metaRes.ok) throw new Error(`HTTP ${metaRes.status}`);
        const json = await metaRes.json();
        const full = fullRes?.ok ? await fullRes.json() : null;
        if (cancelled) return;
        setData(json);
        // Seed live counters from persisted progress
        const progress = full?.progress || {};
        setLive((prev) => ({
          entities: progress.entitiesDiscovered || json.counts?.entities || prev.entities,
          edges: progress.edgesCreated || json.counts?.edges || prev.edges,
          depth: progress.currentDepth || prev.depth,
          apiCalls: progress.apiCallsMade || prev.apiCalls,
          matches: full?.matches?.length || progress.resolution?.matches || prev.matches,
        }));
        // If complete, redirect to overview
        if (json.status === 'COMPLETE') {
          router.replace(`/investigate/${id}/overview`);
          return;
        }
      } catch (e: any) {
        if (!cancelled) setErr(e.message);
      }
    }

    fetchData();
    const poll = setInterval(fetchData, 5000);
    return () => { cancelled = true; socket.disconnect(); clearInterval(poll); };
  }, [id, router]);

  if (err) {
    return (
      <main className="min-h-screen">
        <NavBar />
        <div className="flex items-center justify-center px-6" style={{ minHeight: 'calc(100vh - 57px)' }}>
          <div className="text-center max-w-md">
            <div className="text-signal-critical text-2xl font-medium">Error</div>
            <div className="text-ink-300 mt-3 text-sm">{err}</div>
            <Link href="/" className="inline-block mt-8 px-5 py-2.5 bg-ink-50 text-ink-900 rounded-sm text-sm font-medium hover:bg-white transition-colors">New search</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen">
        <NavBar />
        <div className="max-w-7xl mx-auto px-8 py-8 animate-pulse space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white/5 rounded-sm" />
            <div className="h-4 w-48 bg-white/5 rounded-sm" />
          </div>
          <div className="h-64 bg-white/5 rounded-sm" />
        </div>
      </main>
    );
  }

  if (data.status === 'FAILED') {
    return (
      <main className="min-h-screen">
        <NavBar />
        <div className="flex items-center justify-center px-6" style={{ minHeight: 'calc(100vh - 57px)' }}>
          <div className="text-center max-w-md">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Failed</div>
            <div className="text-signal-critical text-2xl font-medium">Investigation failed</div>
            <div className="text-ink-300 mt-3 text-sm">{data.error || 'Unknown error'}</div>
            <Link href="/" className="inline-block mt-8 px-5 py-2.5 bg-ink-50 text-ink-900 rounded-sm text-sm font-medium hover:bg-white transition-colors">New search</Link>
          </div>
        </div>
      </main>
    );
  }

  // In progress
  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="px-8 py-8 max-w-7xl mx-auto">
        <ProgressView status={data.status} live={live} resolution={resolution} scoringStep={scoringStep} startedAt={data.createdAt} investigationId={id} companyName={data.companyName || data.query} tier={data.tier} />
      </div>
    </main>
  );
}
