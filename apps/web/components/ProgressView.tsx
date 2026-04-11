'use client';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import FlipNumbers from 'react-flip-numbers';

function LiveNumber({ value }: { value: number }) {
  return (
    <FlipNumbers
      numbers={value.toLocaleString()}
      play
      height={24}
      width={14}
      color="#F5F5F5"
      background="transparent"
      duration={0.5}
      numberStyle={{ fontWeight: 500, fontFamily: 'Inter, system-ui, sans-serif' }}
      nonNumberStyle={{ color: '#525252', fontWeight: 500 }}
    />
  );
}

// --- Types ---
interface Props {
  status: string;
  live: { entities: number; edges: number; depth: number; apiCalls: number; matches: number };
  resolution?: { processed: number; total: number; matches: number } | null;
  scoringStep?: { step: string; detail?: string } | null;
  startedAt?: string;
  investigationId?: string;
  companyName?: string;
  tier?: string;
  discoveries?: Discovery[];
}

export interface Discovery {
  id: string;
  label: string;
  entityType: string;
  reason: string;
  severity: 'red' | 'amber' | 'green';
  time: number; // seconds since start
}

const STAGES = [
  { key: 'FETCHING',    label: 'Fetching company profile',          hint: 'UK Companies House' },
  { key: 'EXPANDING',   label: 'Expanding ownership network',       hint: 'Directors . PSC . addresses' },
  { key: 'EXPANDING_2', label: 'UBO chain resolution',              hint: 'Tracing corporate PSCs to natural persons' },
  { key: 'RESOLVING',   label: 'Cross-source matching',             hint: 'OpenSanctions 4M+ . ICIJ 770K+' },
  { key: 'RESOLVING_2', label: 'Disqualified director screening',   hint: 'CH disqualified-officers register' },
  { key: 'SCORING',     label: 'Filing health & jurisdiction risk',  hint: 'Late filings . phoenix . offshore' },
  { key: 'SCORING_2',   label: 'Anomaly detection & risk scoring',  hint: 'Shell . cross-directorship . age anomalies' },
];

const ORDER = ['QUEUED', 'FETCHING', 'EXPANDING', 'EXPANDING_2', 'RESOLVING', 'RESOLVING_2', 'SCORING', 'SCORING_2', 'COMPLETE'];

const PCT_MAP: Record<string, number> = { QUEUED: 0, FETCHING: 7, EXPANDING: 21, RESOLVING: 50, SCORING: 78, COMPLETE: 100 };
const STAGE_MAP: Record<string, number> = { FETCHING: 0, EXPANDING: 1, RESOLVING: 3, SCORING: 5 };
const ACTIVE_MAP: Record<string, number> = { QUEUED: -1, FETCHING: 0, EXPANDING: 1, RESOLVING: 3, SCORING: 5, COMPLETE: 99 };

const TIER_EST: Record<string, [number, number]> = { QUICK: [60, 120], STANDARD: [300, 600], DEEP: [900, 1800] };

export function ProgressView({ status, live, resolution, scoringStep, startedAt, investigationId, companyName, tier, discoveries }: Props) {
  const elapsed = useElapsed(startedAt);
  const overallPct = (() => {
    const start: Record<string, number> = { QUEUED: 0, FETCHING: 3, EXPANDING: 10, RESOLVING: 40, SCORING: 78, COMPLETE: 100 };
    const end: Record<string, number> = { QUEUED: 3, FETCHING: 10, EXPANDING: 40, RESOLVING: 78, SCORING: 100, COMPLETE: 100 };
    const s = start[status] ?? 0;
    const e = end[status] ?? 0;
    if (status === 'RESOLVING' && resolution && resolution.total > 0) {
      return Math.round(s + (e - s) * (resolution.processed / resolution.total));
    }
    return s;
  })();
  const currentStageLabel = STAGE_MAP[status] != null ? STAGES[STAGE_MAP[status]]?.label : status === 'COMPLETE' ? 'Complete' : 'Queued';

  // Estimated time remaining — based on tier expected range, not linear extrapolation
  const estimate = (() => {
    if (overallPct >= 90) return 'Almost done...';
    if (overallPct >= 78) return 'Finishing up...';
    const [lo, hi] = TIER_EST[tier || 'STANDARD'] || TIER_EST.STANDARD;
    // Use midpoint of tier range minus elapsed
    const mid = (lo + hi) / 2;
    const remaining = Math.max(0, Math.round(mid - elapsed));
    if (remaining < 30) return 'Less than a minute';
    if (remaining < 90) return '~1 min remaining';
    return `~${Math.ceil(remaining / 60)} min remaining`;
  })();

  return (
    <div className="space-y-6">
      {/* ROW 1: company (left) + counters (right) */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="border border-white/5 bg-ink-850 p-6 flex items-start gap-4 lg:w-72 lg:shrink-0">
          <Avatar name={companyName || '?'} type="company" size={40} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-ink-50 leading-snug">{companyName || 'Loading...'}</div>
          </div>
        </div>
        <div className="border border-white/5 bg-ink-850 flex-1 flex flex-col">
          <div className="px-6 py-5 flex items-center justify-between flex-wrap gap-y-4">
            <div className="pr-6">
              <LiveNumber value={live.entities} />
              <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">entities</div>
            </div>
            <div className="pr-6">
              <LiveNumber value={live.edges} />
              <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">connections</div>
            </div>
            <div className="pr-6">
              <LiveNumber value={live.matches} />
              <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">matches</div>
            </div>
            <div>
              <LiveNumber value={live.apiCalls} />
              <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">API calls</div>
            </div>
            <div className="pr-6">
              <LiveNumber value={live.depth} />
              <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-1">depth</div>
            </div>
          </div>
          {resolution && resolution.total > 0 && (
            <div className="px-6 pt-5 pb-5 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Screening entities against sanctions databases</div>
                <div className="text-[10px] font-mono text-ink-400 tabular-nums">{resolution.processed.toLocaleString()} / {resolution.total.toLocaleString()} - {resolution.matches} match{resolution.matches === 1 ? '' : 'es'}</div>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-signal-clean rounded-full transition-all duration-500" style={{ width: `${Math.round((resolution.processed / resolution.total) * 100)}%` }} />
              </div>
            </div>
          )}
          {scoringStep && (
            <div className="px-6 py-4 border-t border-white/5 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-signal-clean animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-50">{scoringStep.step}</div>
                {scoringStep.detail && <div className="text-[10px] font-mono text-ink-500 mt-0.5">{scoringStep.detail}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ROW 2: progress (left) + pipeline & sonar (right) */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="border border-white/5 bg-ink-850 p-6 lg:w-72 lg:shrink-0 lg:self-stretch">
          <div className="pb-4 border-b border-white/5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-signal-clean animate-pulse shadow-[0_0_12px_rgba(94,230,161,0.7)]" />
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-signal-clean">running</span>
          </div>
          {tier && (
            <div className="py-4 border-b border-white/5">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">Depth</div>
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border ${
                tier === 'DEEP' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
                tier === 'QUICK' ? 'bg-signal-clean/15 text-signal-clean border-signal-clean/30' :
                'bg-white/10 text-ink-50 border-white/20'
              }`}>
                {tier === 'DEEP' ? 'Deep investigation' : tier === 'QUICK' ? 'Quick scan' : 'Standard'}
              </span>
            </div>
          )}
          <div className="py-4 border-b border-white/5">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">Elapsed</div>
            <div className="text-3xl font-medium text-ink-50 tabular-nums">{formatElapsed(elapsed)}</div>
            <div className="text-[10px] font-mono text-ink-500 mt-1">{estimate}</div>
          </div>
          <div className="py-4 border-b border-white/5">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">Stage</div>
            <div className="text-sm text-ink-50">{currentStageLabel}</div>
          </div>
          <div className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">Overall</div>
              <div className="text-[10px] font-mono text-ink-400 tabular-nums">{overallPct}%</div>
            </div>
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-signal-clean rounded-full transition-all duration-700" style={{ width: `${overallPct}%` }} />
            </div>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 border border-white/5 bg-ink-850 p-6">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-5">/ Pipeline</div>
              <ol>
                {STAGES.map((stage, i) => {
                  const activeIdx = ACTIVE_MAP[status] ?? -1;
                  const isActive = i === activeIdx;
                  const isDone = i < activeIdx;
                  return (
                    <li key={stage.key} className="border-b border-white/5 last:border-b-0 py-4 flex items-center gap-4">
                      <div className="text-[10px] font-mono text-ink-500 w-8">/{String(i + 1).padStart(3, '0')}</div>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isDone ? 'bg-signal-clean' : isActive ? 'bg-ink-50 animate-pulse shadow-[0_0_10px_rgba(245,245,245,0.6)]' : 'bg-white/10'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${isActive ? 'text-ink-50' : isDone ? 'text-ink-300' : 'text-ink-500'}`}>{stage.label}</div>
                      </div>
                      {isActive && <span className="text-[10px] font-mono text-ink-400 uppercase tracking-wider shrink-0 whitespace-nowrap">in progress</span>}
                      {isDone && <span className="text-[10px] font-mono text-signal-clean uppercase tracking-wider shrink-0 whitespace-nowrap">complete</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="lg:col-span-7 border border-white/5 bg-ink-850 flex flex-col">
              <div className="px-6 pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Network growth</div>
                  <div className="text-[10px] font-mono text-ink-500 tabular-nums">{live.entities.toLocaleString()} entities - {live.edges.toLocaleString()} connections</div>
                </div>
              </div>
              <div className="flex-1 min-h-[360px] relative">
                <MiniGraph entities={live.entities} edges={live.edges} discoveries={discoveries} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 3: Live discovery feed */}
      <div className="border border-white/5 bg-ink-850">
        <div className="px-6 py-3 border-b border-white/5 flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Live discoveries</div>
          <div className="text-[10px] font-mono text-ink-600">{(discoveries?.length || 0)} notable</div>
        </div>
        {(!discoveries || discoveries.length === 0) ? (
          <div className="px-6 py-6 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-signal-clean animate-pulse" />
            <span className="text-xs text-ink-500 font-mono">Scanning network...</span>
          </div>
        ) : (
          <DiscoveryFeed items={discoveries.slice(-8)} />
        )}
      </div>

      <div className="text-xs font-mono text-ink-600 flex items-center justify-between">
        <span>{investigationId ? `INV-${investigationId.slice(0, 8)}` : ''}</span>
        <span>{startedAt ? `Started ${new Date(startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${new Date(startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
      </div>

    </div>
  );
}


/**
 * Sonar / radar visualization with entity name labels on new blips.
 */
type Blip = { angle: number; radiusN: number; bornAt: number; label?: string };
type Pulse = { startedAt: number; intensity: number };

function DiscoveryFeed({ items }: { items: Discovery[] }) {
  const reversed = [...items].reverse();
  const ROW_H = 36;
  const maxVisible = 5;
  const containerH = Math.min(reversed.length, maxVisible) * ROW_H;

  // Track previous count to detect new arrivals and trigger slide
  const prevCountRef = useRef(items.length);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (items.length > prevCountRef.current) {
      // New item arrived — start offset at -ROW_H (new row hidden above), then animate to 0
      setOffset(-ROW_H);
      // Force a reflow, then set to 0 to trigger the CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setOffset(0);
        });
      });
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  return (
    <div className="overflow-hidden" style={{ height: containerH }}>
      <div
        style={{
          transform: `translateY(${offset}px)`,
          transition: offset === 0 ? 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)' : 'none',
        }}
      >
        {reversed.map((d) => (
          <div
            key={d.id}
            className="px-6 flex items-center gap-4 border-b border-white/5 last:border-b-0"
            style={{ height: ROW_H }}
          >
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              d.severity === 'red' ? 'bg-signal-critical' : d.severity === 'amber' ? 'bg-signal-medium' : 'bg-signal-clean'
            }`} />
            <span className="text-xs text-ink-300 truncate">{d.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniGraph({ entities, edges, discoveries }: { entities: number; edges: number; discoveries?: Discovery[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });

  const blipsRef = useRef<Blip[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const lastEntitiesRef = useRef(0);
  const lastAutoPulseRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(performance.now());
  const lastDiscoveryCountRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const latestEntitiesRef = useRef(entities);
  latestEntitiesRef.current = entities;

  const latestDiscoveriesRef = useRef(discoveries);
  latestDiscoveriesRef.current = discoveries;

  useEffect(() => {
    if (size.w === 0 || size.h === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = size.w;
    const H = size.h;
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) * 0.42;

    const PULSE_DURATION = 2400;
    const BLIP_FADE_IN = 600;
    const LABEL_DURATION = 3000;

    function frame() {
      if (!ctx) return;
      const now = performance.now();
      ctx.clearRect(0, 0, W, H);

      // Background grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      const RINGS = 5;
      for (let i = 1; i <= RINGS; i++) {
        const r = (maxR * i) / RINGS;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR * 0.62); ctx.lineTo(cx, cy + maxR * 0.62);
      ctx.stroke();

      // Check for new discoveries - add labeled blips
      const disc = latestDiscoveriesRef.current;
      if (disc && disc.length > lastDiscoveryCountRef.current) {
        const newOnes = disc.slice(lastDiscoveryCountRef.current);
        for (const d of newOnes) {
          blipsRef.current.push({
            angle: Math.random() * Math.PI * 2,
            radiusN: 0.3 + Math.random() * 0.5,
            bornAt: now,
            label: d.label.length > 20 ? d.label.slice(0, 18) + '..' : d.label,
          });
        }
        lastDiscoveryCountRef.current = disc.length;
      }

      // Auto-pulse every 2s
      if (now - lastAutoPulseRef.current > 2000) {
        lastAutoPulseRef.current = now;
        const currentEntities = latestEntitiesRef.current;
        const delta = currentEntities - lastEntitiesRef.current;

        if (currentEntities > 0 && (delta > 0 || lastEntitiesRef.current === 0)) {
          pulsesRef.current.push({
            startedAt: now,
            intensity: Math.min(1, 0.4 + Math.log10((delta || currentEntities) + 1) * 0.3),
          });
          const isInitialSeed = lastEntitiesRef.current === 0 && currentEntities > 10;
          const blipsToAdd = isInitialSeed
            ? Math.min(120, Math.floor(currentEntities / 10))
            : Math.min(20, Math.max(1, Math.ceil(Math.sqrt(Math.abs(delta)))));
          for (let i = 0; i < blipsToAdd; i++) {
            const rawR = Math.random();
            blipsRef.current.push({
              angle: Math.random() * Math.PI * 2,
              radiusN: 0.12 + Math.sqrt(rawR) * 0.86,
              bornAt: isInitialSeed ? now - Math.random() * 3000 : now,
            });
          }
          if (blipsRef.current.length > 400) {
            blipsRef.current.splice(0, blipsRef.current.length - 400);
          }
          lastEntitiesRef.current = currentEntities;
        } else {
          pulsesRef.current.push({ startedAt: now, intensity: 0.35 });
        }
        if (pulsesRef.current.length > 6) pulsesRef.current.splice(0, pulsesRef.current.length - 6);
      }

      // Expanding pulse waves
      const livePulses: Pulse[] = [];
      for (const p of pulsesRef.current) {
        const age = now - p.startedAt;
        if (age > PULSE_DURATION) continue;
        livePulses.push(p);
        const t = age / PULSE_DURATION;
        const r = t * maxR;
        const alpha = (1 - t) * p.intensity * 0.55;
        ctx.strokeStyle = `rgba(94,230,161,${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(94,230,161,${alpha * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.94, r * 0.94 * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      pulsesRef.current = livePulses;

      // Blips
      const orbitOffset = ((now - startedAtRef.current) / 1000) * (Math.PI * 2 / 75);
      const liveBlips: Blip[] = [];
      for (const b of blipsRef.current) {
        const age = now - b.bornAt;
        const alpha = age < BLIP_FADE_IN ? age / BLIP_FADE_IN : 1;
        liveBlips.push(b);

        const r = b.radiusN * maxR;
        const angle = b.angle + orbitOffset;
        const baseX = cx + Math.cos(angle) * r;
        const baseY = cy + Math.sin(angle) * r * 0.62;

        let highlight = 0;
        let waveOffset = 0;
        for (const p of livePulses) {
          const t = (now - p.startedAt) / PULSE_DURATION;
          const pulseR = t * maxR;
          const distFromPulse = Math.abs(pulseR - r);
          if (distFromPulse < 18) {
            const proximity = 1 - distFromPulse / 18;
            highlight = Math.max(highlight, proximity * (1 - t));
            waveOffset = Math.max(waveOffset, Math.sin(proximity * Math.PI) * 5 * (1 - t));
          }
        }

        const x = baseX;
        const y = baseY - waveOffset;

        const baseAlpha = Math.min(1, alpha * 0.85);
        if (highlight > 0.15) {
          ctx.fillStyle = `rgba(94,230,161,${highlight * 0.15})`;
          ctx.beginPath();
          ctx.arc(x, y, 8 + highlight * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(94,230,161,${Math.min(1, baseAlpha + highlight)})`;
          ctx.shadowColor = 'rgba(94,230,161,0.9)';
          ctx.shadowBlur = 14 * highlight;
          ctx.beginPath();
          ctx.arc(x, y, 2 + highlight * 1.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = `rgba(200,200,200,${baseAlpha * 0.7})`;
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Label on new blips (show for LABEL_DURATION then fade)
        if (b.label && age < LABEL_DURATION) {
          const labelAlpha = age < 300 ? age / 300 : age > LABEL_DURATION - 600 ? (LABEL_DURATION - age) / 600 : 1;
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillStyle = `rgba(94,230,161,${labelAlpha * 0.7})`;
          ctx.fillText(b.label, x + 6, y - 4);
        }
      }
      blipsRef.current = liveBlips;

      // Center node
      let centerGlow = 0;
      for (const p of livePulses) {
        const age = (now - p.startedAt) / PULSE_DURATION;
        if (age < 0.3) centerGlow = Math.max(centerGlow, (1 - age / 0.3) * p.intensity);
      }
      if (centerGlow > 0.05) {
        ctx.fillStyle = `rgba(94,230,161,${centerGlow * 0.12})`;
        ctx.beginPath(); ctx.arc(cx, cy, 35 + centerGlow * 15, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = `rgba(94,230,161,${0.08 + centerGlow * 0.15})`;
      ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(94,230,161,${0.15 + centerGlow * 0.25})`;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F5F5F5';
      ctx.shadowColor = `rgba(94,230,161,${0.5 + centerGlow * 0.5})`;
      ctx.shadowBlur = 10 + centerGlow * 20;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [size]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}

function useElapsed(startedAt?: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatMmSs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
