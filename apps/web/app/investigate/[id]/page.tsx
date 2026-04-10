'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { GraphVisualization, GraphNode } from '../../../components/GraphVisualization';
import { ProgressView } from '../../../components/ProgressView';
import { RiskGauge, FindingRow } from '../../../components/RiskReport';
import { Avatar } from '../../../components/Avatar';
import { Insights } from '../../../components/Insights';
import { AddressMap } from '../../../components/AddressMap';
import { LocationsMap } from '../../../components/LocationsMap';
import { NetworkGlobe } from '../../../components/NetworkGlobe';
import { FindingsTab } from '../../../components/tabs/FindingsTab';
import { UBOTab } from '../../../components/tabs/UBOTab';
import { EntitiesTab } from '../../../components/tabs/EntitiesTab';
import { MatchesTab } from '../../../components/tabs/MatchesTab';
import { EmptyState, ProximityDot } from '../../../components/tabs/shared';

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
  companyName?: string;
  tier?: 'QUICK' | 'STANDARD' | 'DEEP';
  status: 'QUEUED' | 'FETCHING' | 'EXPANDING' | 'RESOLVING' | 'SCORING' | 'COMPLETE' | 'FAILED';
  createdAt?: string;
  progress?: any;
  counts?: { companies: number; people: number; addresses: number; edges: number };
  entities?: { company: any[]; person: any[]; address: any[] };
  edges?: any[];
  matches?: any[];
  riskScore?: number;
  findings?: Finding[];
  error?: string;
}

type Tab = 'overview' | 'graph' | 'locations' | 'ubo' | 'findings' | 'entities' | 'matches';

export default function InvestigatePage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<Investigation | null>(null);
  const [graph, setGraph] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
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
    socket.on('expansion_complete', () => { setScoringStep(null); fetchData(); });

    async function fetchData() {
      try {
        const res = await fetch(`${API}/api/investigations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        // Seed live counters from persisted progress so reload shows real numbers
        if (json.progress) {
          setLive((prev) => ({
            entities: json.progress.entitiesDiscovered || json.counts?.companies + json.counts?.people + json.counts?.addresses || prev.entities,
            edges: json.progress.edgesCreated || json.counts?.edges || prev.edges,
            depth: json.progress.currentDepth || prev.depth,
            apiCalls: json.progress.apiCallsMade || prev.apiCalls,
            matches: json.matches?.length || prev.matches,
          }));
        }
        if (json.status === 'COMPLETE') {
          const gr = await fetch(`${API}/api/investigations/${id}/graph`);
          if (gr.ok) setGraph(await gr.json());
        }
        if (json.status !== 'COMPLETE' && json.status !== 'FAILED') {
          setTimeout(fetchData, 1000);
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
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Error</div>
          <div className="text-signal-critical text-2xl font-medium">Failed to load</div>
          <div className="text-ink-400 mt-2 text-sm">{err}</div>
          <a href="/" className="inline-block mt-8 text-sm text-ink-300 hover:text-ink-50 transition-colors border-b border-white/20 pb-0.5">← Back to search</a>
        </div>
      </main>
    );
  }
  if (!data) return <LoadingSkeleton />;

  const isRunning = data.status !== 'COMPLETE' && data.status !== 'FAILED';

  if (isRunning) {
    return (
      <main className="min-h-screen">
        <NavBar />
        <div className="px-8 py-12 max-w-7xl mx-auto">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Investigation in progress</div>
          <div className="flex items-center gap-4 mb-12">
            <Avatar name={data.companyName || data.query} type="company" size={48} />
            <h1 className="text-4xl font-medium tracking-tight text-ink-50">{data.companyName || data.query}</h1>
            {data.tier && <TierBadge tier={data.tier} />}
          </div>
          <ProgressView status={data.status} live={live} resolution={resolution} scoringStep={scoringStep} startedAt={data.createdAt} />
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
            <a href="/" className="inline-block mt-8 px-5 py-2.5 bg-ink-50 text-ink-900 rounded-sm text-sm font-medium hover:bg-white transition-colors">New search</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <NavBar />

      {/* Investigation header */}
      <header className="sticky top-[57px] z-20 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-4">
            <Avatar name={data.companyName || data.query} type="company" size={28} />
            <h1 className="text-base font-medium tracking-tight text-ink-50 truncate">{data.companyName || data.query}</h1>
            {data.tier && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-white/10 text-ink-400">
                {data.tier}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <WatchButton
              companyNumber={(data as any).rootCompanyNumber}
              companyName={data.companyName || data.query}
              investigationId={id}
              riskScore={data.riskScore}
            />
            <ExportButton investigationId={id} />
          </div>
        </div>
        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-8">
          <nav className="flex gap-8">
            {(['overview', 'graph', 'locations', 'ubo', 'findings', 'entities', 'matches'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative py-3 text-xs font-mono uppercase tracking-[0.15em] transition-colors ${
                  tab === t ? 'text-ink-50' : 'text-ink-500 hover:text-ink-300'
                }`}
              >
                {t}
                {t === 'findings' && data.findings && data.findings.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-ink-500">{data.findings.length}</span>
                )}
                {t === 'matches' && data.matches && data.matches.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-ink-500">{data.matches.length}</span>
                )}
                {tab === t && <span className="absolute bottom-0 inset-x-0 h-px bg-ink-50" />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-8 py-12">
        {tab === 'overview' && <OverviewTab data={data} investigationId={id} />}
        {tab === 'graph' && <GraphTab graph={graph} onSelect={setSelectedNode} selected={selectedNode} data={data} />}
        {tab === 'locations' && <LocationsMap addresses={data.entities?.address || []} edges={data.edges || []} allEntities={data.entities} />}
        {tab === 'ubo' && <UBOTab chains={(data as any).uboChains || []} />}
        {tab === 'findings' && <FindingsTab findings={data.findings || []} entities={data.entities} investigationId={id} />}
        {tab === 'entities' && <EntitiesTab entities={data.entities} investigationId={id} />}
        {tab === 'matches' && <MatchesTab matches={data.matches || []} counts={data.counts} />}
      </div>
    </main>
  );
}

function OverviewTab({ data, investigationId }: { data: Investigation; investigationId: string }) {
  // Find the root company in entities
  const rootCompany = useMemo(() => {
    return (data.entities?.company || []).find((c: any) => c.entityId === data.rootCompanyNumber)
      || (data.entities?.company || [])[0];
  }, [data]);

  const score = data.riskScore || 0;
  // Prefer server-computed breakdown; fall back to client recompute for old runs
  const breakdown = useMemo(() => {
    if (data.progress?.scoreBreakdown) return data.progress.scoreBreakdown;
    return computeBreakdownFromData(data, score);
  }, [data, score]);

  // ----- Composition breakdowns -----
  const composition = useMemo(() => {
    const comp = { LARGE_PUBLIC: 0, ESTABLISHED_PRIVATE: 0, SMALL_PRIVATE: 0, MICRO_ENTITY: 0, NEWLY_FORMED: 0, DISSOLVED: 0, FOREIGN: 0 } as Record<string, number>;
    for (const c of data.entities?.company || []) {
      const p = c.metadata?.companyProfile || 'UNKNOWN';
      comp[p] = (comp[p] || 0) + 1;
    }
    const dir = { NORMAL: 0, PROFESSIONAL_DIRECTOR: 0, SERIAL_ENTREPRENEUR: 0, NOMINEE_PATTERN: 0, FORMATION_AGENT: 0 } as Record<string, number>;
    for (const p of data.entities?.person || []) {
      const r = p.metadata?.directorProfile?.risk || 'NORMAL';
      dir[r] = (dir[r] || 0) + 1;
    }
    const addr = { NORMAL: 0, CORPORATE_HQ: 0, BUSINESS_CENTER: 0, RESIDENTIAL: 0, VIRTUAL_OFFICE: 0, FORMATION_AGENT: 0 } as Record<string, number>;
    for (const a of data.entities?.address || []) {
      const c = a.metadata?.addressAnalysis?.classification || 'NORMAL';
      addr[c] = (addr[c] || 0) + 1;
    }
    return { companies: comp, people: dir, addresses: addr };
  }, [data]);

  // ----- Hot spots -----
  const hotSpots = useMemo(() => {
    // Top hub person by degree
    const topPerson = [...(data.entities?.person || [])]
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];
    // Densest address by companyCount
    const topAddress = [...(data.entities?.address || [])]
      .sort((a, b) => (b.metadata?.companyCount || 0) - (a.metadata?.companyCount || 0))[0];
    // Highest-confidence sanctions match
    const topMatch = [...(data.matches || [])]
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return { topPerson, topAddress, topMatch };
  }, [data]);

  // ----- Geographic markers for the globe -----
  const globeMarkers = useMemo(() => {
    const markers: Array<{ location: [number, number]; size: number; label?: string }> = [];
    const addresses = data.entities?.address || [];
    for (const a of addresses) {
      const geo = a.metadata?.geo;
      if (geo?.lat != null && geo?.lng != null) {
        const density = a.metadata?.companyCount || 1;
        markers.push({
          location: [geo.lat, geo.lng],
          size: Math.min(0.15, 0.04 + Math.log10(density + 1) * 0.04),
          label: a.label,
        });
      }
    }
    return markers;
  }, [data]);

  // ----- Recommendations from findings -----
  const recommendations = useMemo(() => {
    const seen = new Set<string>();
    const recs: Array<{ severity: string; text: string }> = [];
    for (const f of data.findings || []) {
      if (!f.recommendation || seen.has(f.recommendation)) continue;
      seen.add(f.recommendation);
      recs.push({ severity: f.severity, text: f.recommendation });
      if (recs.length >= 5) break;
    }
    return recs;
  }, [data]);

  const top3 = (data.findings || []).filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3);
  const meta = rootCompany?.metadata || {};
  const elapsedSec = data.createdAt && data.completedAt
    ? Math.floor((new Date(data.completedAt).getTime() - new Date(data.createdAt).getTime()) / 1000)
    : null;

  return (
    <div className="space-y-8">
      {/* ===== 1. COMPANY HERO + RISK SCORE ===== */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-white/5 border border-white/5">
        {/* Hero (left, 2/3) */}
        <div className="lg:col-span-2 bg-ink-850 p-8">
          <div className="flex items-start gap-6">
            <Avatar name={data.companyName || data.query} type="company" size={64} />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">/ Target entity</div>
              <h2 className="text-3xl font-medium tracking-tight text-ink-50 break-words">
                {data.companyName || data.query}
              </h2>
              <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-6">
                {meta.status && <HeroField label="Status" value={titleCase(meta.status)} />}
                {meta.companyType && <HeroField label="Type" value={titleCase(meta.companyType)} />}
                {meta.companyProfile && <HeroField label="Profile" value={titleCase(meta.companyProfile)} />}
                {meta.incorporationDate && <HeroField label="Incorporated" value={meta.incorporationDate} />}
                {meta.jurisdiction && <HeroField label="Jurisdiction" value={titleCase(meta.jurisdiction)} />}
                {meta.accountsType && <HeroField label="Accounts" value={titleCase(meta.accountsType)} />}
                {data.rootCompanyNumber && <HeroField label="Number" value={data.rootCompanyNumber} mono />}
              </div>
            </div>
          </div>
        </div>

        {/* Risk score (right, 1/3) */}
        <div className="bg-ink-850 p-8 flex flex-col items-center justify-center">
          <RiskGauge score={score} />
        </div>
      </section>

      {/* ===== 2. SCORE COMPOSITION + GLOBE side-by-side ===== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className="flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Score composition</div>
          <div className="border border-white/5 bg-ink-850 p-8 flex-1 flex flex-col justify-center">
            <ScoreBar label="Sanctions exposure" value={breakdown.sanctions} max={40} color="#FF4D4D" />
            <ScoreBar label="Structural patterns" value={breakdown.structural} max={35} color="#F5C518" />
            <ScoreBar label="Director profiles" value={breakdown.director} max={25} color="#FF8A3D" />
            <div className="mt-6 pt-4 border-t border-white/5 flex items-baseline justify-between">
              <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">Total risk score</span>
              <span className="text-3xl font-medium text-ink-50 tabular-nums">{breakdown.total}<span className="text-ink-500 text-base ml-1">/ 100</span></span>
            </div>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Geographic footprint</div>
          <div className="relative border border-white/5 bg-ink-850 flex-1 overflow-hidden min-h-[380px]">
            {/* Header text — sits on top of the globe, anchored to top-left corner */}
            <div className="absolute top-5 left-5 z-10">
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-medium text-ink-50 tabular-nums">{globeMarkers.length}</span>
                <span className="text-sm text-ink-400">geocoded location{globeMarkers.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="mt-2 text-[10px] font-mono text-ink-500">
                {(() => {
                  const jur = new Set<string>();
                  for (const c of data.entities?.company || []) {
                    if (c.metadata?.jurisdiction) jur.add(c.metadata.jurisdiction);
                  }
                  return jur.size > 0 ? `Across ${jur.size} jurisdiction${jur.size !== 1 ? 's' : ''}` : '';
                })()}
              </div>
            </div>
            {/* Globe positioned absolutely at the bottom, spills out via overflow-hidden parent */}
            <NetworkGlobe markers={globeMarkers} />
          </div>
        </div>
      </section>

      {/* ===== 3. AI INSIGHTS — narrative right after the score so it explains "why" in plain English ===== */}
      <Insights investigationId={investigationId} />

      {/* ===== 4. HOT SPOTS — the named offenders, immediately after the narrative ===== */}
      {(hotSpots.topPerson || hotSpots.topAddress || hotSpots.topMatch) && (
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Hot spots</div>
          <div className="grid gap-px bg-white/5 border border-white/5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {hotSpots.topPerson && (
              <HotSpotCard
                label="Most connected person"
                title={hotSpots.topPerson.label}
                value={`${hotSpots.topPerson.degree || 0} connections`}
                accent={hotSpots.topPerson.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN' || hotSpots.topPerson.metadata?.directorProfile?.risk === 'FORMATION_AGENT'}
                tag={hotSpots.topPerson.metadata?.directorProfile?.risk}
              />
            )}
            {hotSpots.topAddress && (
              <HotSpotCard
                label="Densest address"
                title={hotSpots.topAddress.label}
                value={`${hotSpots.topAddress.metadata?.companyCount || 1} companies`}
                accent={hotSpots.topAddress.metadata?.addressAnalysis?.classification === 'VIRTUAL_OFFICE' || hotSpots.topAddress.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT'}
                tag={hotSpots.topAddress.metadata?.addressAnalysis?.classification}
              />
            )}
            {hotSpots.topMatch && (
              <HotSpotCard
                label="Top sanctions match"
                title={hotSpots.topMatch.reasons?.matchedName || hotSpots.topMatch.matchedEntityId}
                value={`${hotSpots.topMatch.confidence}% · ${hotSpots.topMatch.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ'}`}
                accent
                tag={hotSpots.topMatch.source === 'opensanctions' ? 'SANCTIONS' : 'OFFSHORE'}
              />
            )}
          </div>
        </section>
      )}

      {/* ===== 5. NETWORK COMPOSITION (supporting context, after hot spots) ===== */}
      <section>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Network composition</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
          <CompositionCard
            label="Companies"
            total={data.counts?.companies || 0}
            breakdown={composition.companies}
            dangerKeys={['MICRO_ENTITY', 'NEWLY_FORMED', 'DISSOLVED']}
          />
          <CompositionCard
            label="People"
            total={data.counts?.people || 0}
            breakdown={composition.people}
            dangerKeys={['NOMINEE_PATTERN', 'FORMATION_AGENT']}
          />
          <CompositionCard
            label="Addresses"
            total={data.counts?.addresses || 0}
            breakdown={composition.addresses}
            dangerKeys={['VIRTUAL_OFFICE', 'FORMATION_AGENT']}
          />
        </div>
      </section>

      {/* ===== 6. TOP FINDINGS + RECOMMENDATIONS side-by-side ===== */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className="flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Top critical findings</div>
          {top3.length === 0 ? (
            <div className="border border-white/5 bg-ink-850 p-8 flex-1 flex items-center justify-center">
              <EmptyState message="No critical findings detected." />
            </div>
          ) : (
            <div className="space-y-2 flex-1">
              {top3.map((f, i) => <FindingRow key={i} finding={f} />)}
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Recommended next steps</div>
          <div className="border border-white/5 bg-ink-850 p-6 flex-1">
            {recommendations.length === 0 ? (
              <EmptyState message="No recommended actions." />
            ) : (
              <ul className="space-y-3">
                {recommendations.map((r, i) => {
                const sevColor = r.severity === 'CRITICAL' ? 'text-signal-critical'
                  : r.severity === 'HIGH' ? 'text-signal-high'
                  : r.severity === 'MEDIUM' ? 'text-signal-medium' : 'text-ink-400';
                return (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className={`${sevColor} mt-0.5 shrink-0`}>›</span>
                    <span className="text-ink-300 leading-relaxed">{r.text}</span>
                  </li>
                );
              })}
            </ul>
            )}
          </div>
        </div>
      </section>

      {/* ===== METADATA FOOTER ===== */}
      <section className="border-t border-white/5 pt-8">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 flex flex-wrap gap-x-6 gap-y-2">
          {data.tier && <span>Tier · <span className="text-ink-300">{data.tier}</span></span>}
          {data.createdAt && <span>Started · <span className="text-ink-300">{new Date(data.createdAt).toLocaleString()}</span></span>}
          {elapsedSec !== null && <span>Duration · <span className="text-ink-300">{formatDurationSec(elapsedSec)}</span></span>}
          {data.progress?.apiCallsMade !== undefined && <span>API calls · <span className="text-ink-300">{data.progress.apiCallsMade.toLocaleString()}</span></span>}
          {data.progress?.currentDepth !== undefined && <span>Depth · <span className="text-ink-300">{data.progress.currentDepth}</span></span>}
        </div>
      </section>
    </div>
  );
}

function HeroField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-ink-500">{label}</div>
      <div className={`text-ink-100 truncate mt-0.5 ${mono ? 'font-mono text-xs' : ''}`}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm text-ink-100">{label}</span>
        <span className="text-xs font-mono text-ink-400 tabular-nums">{value} <span className="text-ink-600">/ {max}</span></span>
      </div>
      <div className="h-1.5 w-full rounded-sm bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-sm transition-[width] duration-700"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 12px ${color}55` }}
        />
      </div>
    </div>
  );
}

function CompositionCard({
  label, total, breakdown, dangerKeys = [],
}: {
  label: string; total: number; breakdown: Record<string, number>; dangerKeys?: string[];
}) {
  const entries = Object.entries(breakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="bg-ink-850 p-6">
      <div className="text-3xl font-medium text-ink-50 tabular-nums">{total}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono mb-4">{label}</div>
      <ul className="space-y-1.5">
        {entries.map(([key, val]) => (
          <li key={key} className="flex items-center justify-between text-[10px] font-mono">
            <span className={dangerKeys.includes(key) ? 'text-signal-critical' : 'text-ink-400'}>
              {titleCase(key)}
            </span>
            <span className={`tabular-nums ${dangerKeys.includes(key) ? 'text-signal-critical' : 'text-ink-300'}`}>{val}</span>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="text-[10px] font-mono text-ink-600">none</li>
        )}
      </ul>
    </div>
  );
}

function HotSpotCard({
  label, title, value, accent, tag,
}: {
  label: string; title: string; value: string; accent?: boolean; tag?: string;
}) {
  return (
    <div className={`bg-ink-850 p-6 ${accent ? 'border-l-2 border-signal-critical' : ''}`}>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 font-mono mb-3">{label}</div>
      <div className="text-base font-medium text-ink-50 truncate" title={title}>{title}</div>
      <div className="text-xs text-ink-400 mt-1">{value}</div>
      {tag && (
        <div className="mt-3">
          <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
            accent ? 'bg-signal-critical/10 text-signal-critical border-signal-critical/30' : 'bg-white/5 text-ink-400 border-white/10'
          }`}>{tag.replace(/_/g, ' ')}</span>
        </div>
      )}
    </div>
  );
}

/** Title-case a string but preserve known initialisms (PLC, LLP, UK…). */
function titleCase(s: string): string {
  if (!s) return '';
  const initialisms = new Set(['PLC', 'LLP', 'LTD', 'LLC', 'UK', 'USA', 'PSC', 'CIC', 'SE', 'EU', 'GB', 'NI']);
  return s
    .replace(/_/g, ' ')
    .split(/(\s|-)/)
    .map((part) => {
      if (part === ' ' || part === '-') return part;
      const u = part.toUpperCase();
      if (initialisms.has(u)) return u;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function formatDurationSec(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * Client-side score breakdown — mirrors the backend's calculateScoreBreakdown.
 * Used as a fallback for investigations completed before the breakdown was
 * being persisted by the API.
 */
function computeBreakdownFromData(data: Investigation, fallbackTotal: number) {
  let sanctions = 0;
  let structural = 0;
  let director = 0;

  // ---- Sanctions component (max 40) ----
  for (const m of data.matches || []) {
    if (m.source === 'opensanctions') {
      if (m.confidence > 80) sanctions = Math.max(sanctions, 40);
      else if (m.confidence >= 60) sanctions = Math.max(sanctions, 30);
    } else if (m.source === 'offshore_leaks') {
      if (m.confidence > 80) sanctions = Math.max(sanctions, 25);
      else if (m.confidence >= 60) sanctions = Math.max(sanctions, 15);
    }
  }
  // Network proximity bumps from any node
  const allNodes = [
    ...(data.entities?.company || []),
    ...(data.entities?.person || []),
    ...(data.entities?.address || []),
  ];
  for (const n of allNodes) {
    if (n.proximityScore === 'HIGH' && n.proximityHops === 1) sanctions = Math.min(40, Math.max(sanctions, 20));
    if (n.proximityScore === 'MEDIUM' && n.proximityHops === 2) sanctions = Math.min(40, Math.max(sanctions, 10));
  }

  // ---- Structural component (max 35) — derive presence from findings ----
  const findings = data.findings || [];
  const hasCycle = findings.some((f) => f.type === 'CIRCULAR_OWNERSHIP');
  if (hasCycle) structural += 25;
  const shellNetworkPresent = (data.entities?.company || []).some((c: any) => {
    const sc = c.metadata?.shellCompanyScore;
    const profile = c.metadata?.companyProfile;
    return (sc?.risk === 'HIGH' || sc?.risk === 'CRITICAL') &&
      (profile === 'SMALL_PRIVATE' || profile === 'MICRO_ENTITY' || profile === 'NEWLY_FORMED');
  });
  if (shellNetworkPresent) structural += 20;
  const formationAgentPresent = (data.entities?.address || []).some((a: any) =>
    a.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT',
  );
  if (formationAgentPresent) structural += 10;
  const massIncCount = findings.filter((f) => f.type === 'MASS_INCORPORATION').length;
  if (massIncCount > 0) structural += 10;
  const rapidDissCount = findings.filter((f) => f.type === 'RAPID_DISSOLUTION').length;
  if (rapidDissCount >= 2) structural += 8;
  structural = Math.min(35, structural);

  // ---- Director component (max 25) ----
  const formationAgents = (data.entities?.person || []).filter(
    (p: any) => p.metadata?.directorProfile?.risk === 'FORMATION_AGENT',
  ).length;
  const nominees = (data.entities?.person || []).filter(
    (p: any) => p.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN',
  ).length;
  if (formationAgents > 0) director += 25;
  else if (nominees > 0) director += 15;
  else {
    const heavyDissolver = (data.entities?.person || []).some((p: any) => {
      const dp = p.metadata?.directorProfile;
      return dp && dp.dissolved >= 5;
    });
    if (heavyDissolver) director += 10;
  }
  director = Math.min(25, director);

  let total = Math.min(100, sanctions + structural + director);

  // If our recompute lands well below the persisted total (because the
  // analyzer metadata isn't on entities for very old runs), distribute the
  // remainder proportionally so the bars at least add up to the displayed
  // total. This is purely cosmetic for legacy investigations.
  if (total < fallbackTotal) {
    const gap = fallbackTotal - total;
    // Give the gap to whichever component has the most headroom
    const sanctionsRoom = 40 - sanctions;
    const structuralRoom = 35 - structural;
    const directorRoom = 25 - director;
    if (sanctionsRoom >= structuralRoom && sanctionsRoom >= directorRoom) {
      sanctions += Math.min(sanctionsRoom, gap);
    } else if (structuralRoom >= directorRoom) {
      structural += Math.min(structuralRoom, gap);
    } else {
      director += Math.min(directorRoom, gap);
    }
    total = sanctions + structural + director;
  }

  return { sanctions, structural, director, total };
}

function GraphTab({ graph, onSelect, selected, data }: { graph: any; onSelect: (n: GraphNode | null) => void; selected: GraphNode | null; data: Investigation }) {
  if (!graph) return <LoadingSkeleton />;
  if (graph.nodes.length === 0) return <EmptyState message="No graph data available." />;

  // Compact stats line for the header
  const sanctioned = graph.nodes.filter((n: any) => n.hasMatch).length;
  const shell = graph.nodes.filter((n: any) => n.shellRisk === 'HIGH' || n.shellRisk === 'CRITICAL').length;
  const personHub = [...graph.nodes]
    .filter((n: any) => n.entityType === 'person')
    .sort((a: any, b: any) => (b.degree || 0) - (a.degree || 0))[0];

  return (
    <div className="space-y-4">
      {/* Compact one-line caption — replaces the bulky narrative strip */}
      <div className="flex items-center justify-between text-[10px] font-mono text-ink-500 px-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span><span className="text-ink-300">{graph.nodes.length.toLocaleString()}</span> nodes</span>
          <span className="text-ink-700">·</span>
          <span><span className="text-ink-300">{graph.links.length.toLocaleString()}</span> links</span>
          {personHub && personHub.degree >= 3 && (
            <>
              <span className="text-ink-700">·</span>
              <span>top hub <span className="text-ink-300">{personHub.label}</span> ({personHub.degree})</span>
            </>
          )}
          {sanctioned > 0 && (
            <>
              <span className="text-ink-700">·</span>
              <span className="text-signal-critical">{sanctioned} sanctioned</span>
            </>
          )}
          {shell > 0 && (
            <>
              <span className="text-ink-700">·</span>
              <span className="text-signal-medium">{shell} shell</span>
            </>
          )}
        </div>
        <span className="text-ink-600">click any node · drag to reposition · scroll to zoom</span>
      </div>

      {/* Graph + selection panel */}
      <div className="relative">
        <GraphVisualization
          nodes={graph.nodes}
          links={graph.links}
          findings={data.findings as any}
          height={760}
          onNodeClick={onSelect}
        />
        {selected && (
          <aside className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] overflow-auto border border-white/10 bg-ink-900/95 backdrop-blur-md p-5 shadow-2xl z-20">
            <div className="flex items-start justify-between mb-4">
              <Avatar name={selected.label} type={selected.entityType as any} size={44} />
              <button onClick={() => onSelect(null)} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">×</button>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{selected.entityType}</div>
            <h3 className="font-medium text-ink-50 mt-1 break-words">{selected.label}</h3>

            <dl className="mt-5 space-y-3 text-sm border-t border-white/5 pt-4">
              <Field label="Connections" value={String(selected.degree)} />
              {selected.proximityScore && selected.proximityScore !== 'CLEAR' && (
                <Field label="Proximity" value={selected.proximityScore} highlight />
              )}
              {selected.shellRisk && <Field label="Shell risk" value={selected.shellRisk} highlight={selected.shellRisk === 'HIGH'} />}
              {selected.addressFlag && <Field label="Address flag" value={selected.addressFlag} />}
              {selected.hasMatch && <Field label="Sanctions" value="Match found" highlight />}
            </dl>

            {selected.metadata && Object.keys(selected.metadata).length > 0 && (
              <details className="mt-5">
                <summary className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 cursor-pointer hover:text-ink-300">/ Raw metadata</summary>
                <pre className="text-[10px] text-ink-400 mt-2 overflow-auto max-h-64 bg-ink-900 p-3 rounded-sm border border-white/5">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </details>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-xs uppercase tracking-wider font-mono">{label}</dt>
      <dd className={`font-medium text-right ${highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</dd>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'QUICK' | 'STANDARD' | 'DEEP' }) {
  const styles: Record<string, { box: string; label: string }> = {
    QUICK:    { box: 'bg-signal-clean/10 text-signal-clean border-signal-clean/30', label: 'QUICK · FREE' },
    STANDARD: { box: 'bg-white/5 text-ink-100 border-white/20',                       label: 'STANDARD' },
    DEEP:     { box: 'bg-signal-medium/10 text-signal-medium border-signal-medium/30', label: '⊘ DEEP · PREMIUM' },
  };
  const s = styles[tier];
  return (
    <span className={`text-[10px] font-mono uppercase tracking-[0.15em] px-2.5 py-1 rounded-sm border ${s.box}`}>
      {s.label}
    </span>
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
      className="px-4 py-2 text-xs font-mono uppercase tracking-wider rounded-sm border border-white/10 hover:bg-white/5 disabled:opacity-50 transition-colors text-ink-300"
    >
      {busy ? 'Exporting…' : 'Export PDF →'}
    </button>
  );
}

interface Narrative {
  totalNodes: number;
  totalLinks: number;
  rootLabel: string;
  hub?: { label: string; degree: number };
  flaggedAddress?: { label: string; density: number };
  sanctionedCount: number;
  shellCount: number;
  bullets: string[];
}

function buildGraphNarrative(graph: { nodes: any[]; links: any[] }, data: Investigation): Narrative {
  const nodes = graph.nodes || [];
  const links = graph.links || [];

  // Root = highest-degree node (the seed)
  const sorted = [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0));
  const root = sorted[0];

  // Hub among PERSONS (not the root if root is a company)
  const personHub = sorted.find((n) => n.entityType === 'person');

  // Densest address
  const flaggedAddr = nodes
    .filter((n) => n.entityType === 'address' && n.metadata?.companyCount > 1)
    .sort((a, b) => (b.metadata?.companyCount || 0) - (a.metadata?.companyCount || 0))[0];

  const sanctioned = nodes.filter((n) => n.hasMatch).length;
  const shell = nodes.filter((n) => n.shellRisk === 'HIGH').length;

  const bullets: string[] = [];
  bullets.push(`Network of ${nodes.length} entities and ${links.length} relationships, centered on ${data.companyName || data.query}.`);
  if (personHub && personHub.degree >= 3) {
    bullets.push(`${personHub.label} is the most connected person · sits on ${personHub.degree} entities in this network.`);
  }
  if (flaggedAddr) {
    bullets.push(`${flaggedAddr.metadata.companyCount} companies share an address at ${flaggedAddr.label.slice(0, 60)}${flaggedAddr.label.length > 60 ? '…' : ''}.`);
  }
  if (sanctioned > 0) {
    bullets.push(`${sanctioned} ${sanctioned === 1 ? 'entity matches' : 'entities match'} OpenSanctions or ICIJ OffshoreLeaks records.`);
  }
  if (shell > 0) {
    bullets.push(`${shell} ${shell === 1 ? 'company shows' : 'companies show'} HIGH shell-company signals.`);
  }
  if (data.findings && data.findings.length > 0) {
    const critical = data.findings.filter((f) => f.severity === 'CRITICAL').length;
    if (critical > 0) bullets.push(`${critical} CRITICAL findings raised · see Findings tab.`);
  }

  return {
    totalNodes: nodes.length,
    totalLinks: links.length,
    rootLabel: root?.label || data.query,
    hub: personHub && personHub.degree >= 3 ? { label: personHub.label, degree: personHub.degree } : undefined,
    flaggedAddress: flaggedAddr ? { label: flaggedAddr.label, density: flaggedAddr.metadata.companyCount } : undefined,
    sanctionedCount: sanctioned,
    shellCount: shell,
    bullets,
  };
}

function GraphNarrativeStrip({ narrative }: { narrative: Narrative }) {
  return (
    <div className="border border-white/5 bg-ink-850 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ What you're looking at</div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-ink-500">
          <span>{narrative.totalNodes} nodes</span>
          <span className="text-ink-700">·</span>
          <span>{narrative.totalLinks} links</span>
          {narrative.sanctionedCount > 0 && (
            <>
              <span className="text-ink-700">·</span>
              <span className="text-signal-critical">{narrative.sanctionedCount} sanctioned</span>
            </>
          )}
          {narrative.shellCount > 0 && (
            <>
              <span className="text-ink-700">·</span>
              <span className="text-signal-medium">{narrative.shellCount} shell</span>
            </>
          )}
        </div>
      </div>
      <ul className="space-y-1.5">
        {narrative.bullets.map((b, i) => (
          <li key={i} className="text-sm text-ink-300 flex gap-2">
            <span className="text-ink-500">›</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t border-white/5 text-[10px] font-mono text-ink-500">
        click any node to explore its connections  ·  drag to reposition  ·  scroll to zoom
      </div>
    </div>
  );
}

function WatchButton({ companyNumber, companyName, investigationId, riskScore }: {
  companyNumber?: string; companyName: string; investigationId: string; riskScore?: number;
}) {
  const [watching, setWatching] = useState(false);
  const [done, setDone] = useState(false);

  async function toggle() {
    if (!companyNumber) return;
    setWatching(true);
    try {
      if (done) {
        await fetch(`${API}/api/watchlist/${companyNumber}`, { method: 'DELETE' });
        setDone(false);
      } else {
        await fetch(`${API}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyNumber, companyName, investigationId, riskScore }),
        });
        setDone(true);
      }
    } catch {}
    setWatching(false);
  }

  if (!companyNumber) return null;
  return (
    <button
      onClick={toggle}
      disabled={watching}
      className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-sm border transition-colors ${
        done
          ? 'bg-signal-clean/15 text-signal-clean border-signal-clean/30'
          : 'bg-ink-900 text-ink-400 border-white/10 hover:border-white/30'
      } disabled:opacity-50`}
    >
      {watching ? '…' : done ? '✓ watching' : '+ watch'}
    </button>
  );
}

function NavBar() {
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
      <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
          <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
        </a>
        <div className="flex items-center gap-6 text-sm text-ink-300">
          <a href="/dashboard" className="hover:text-ink-50 transition-colors hidden sm:block">Dashboard</a>
          <a href="/compare" className="hover:text-ink-50 transition-colors hidden sm:block">Compare</a>
          <a href="/watchlist" className="hover:text-ink-50 transition-colors hidden sm:block">Watchlist</a>
        </div>
      </div>
    </nav>
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="max-w-7xl mx-auto px-8 py-12 animate-pulse space-y-6">
        {/* Company header skeleton */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/5 rounded-sm" />
          <div className="space-y-2">
            <div className="h-5 w-64 bg-white/5 rounded-sm" />
            <div className="h-3 w-32 bg-white/5 rounded-sm" />
          </div>
        </div>
        {/* Tabs skeleton */}
        <div className="flex gap-8 border-b border-white/5 pb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-3 w-16 bg-white/5 rounded-sm" />
          ))}
        </div>
        {/* Content skeleton */}
        <div className="h-64 bg-white/5 rounded-sm" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-white/5 rounded-sm" />
          ))}
        </div>
      </div>
    </main>
  );
}
