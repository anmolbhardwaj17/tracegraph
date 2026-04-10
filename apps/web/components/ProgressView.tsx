'use client';
import { useEffect, useRef, useState } from 'react';

interface Props {
  status: string;
  live: { entities: number; edges: number; depth: number; apiCalls: number; matches: number };
  resolution?: { processed: number; total: number; matches: number } | null;
  scoringStep?: { step: string; detail?: string } | null;
  startedAt?: string;
  companyName?: string;
  tier?: string;
}

const STAGES = [
  { key: 'FETCHING',    label: 'Fetching company profile' },
  { key: 'EXPANDING',   label: 'Expanding ownership network' },
  { key: 'EXPANDING_2', label: 'UBO chain resolution' },
  { key: 'RESOLVING',   label: 'Cross-source matching' },
  { key: 'RESOLVING_2', label: 'Disqualified director screening' },
  { key: 'SCORING',     label: 'Filing health & jurisdiction risk' },
  { key: 'SCORING_2',   label: 'Anomaly detection & risk scoring' },
];

export function ProgressView({ status, live, resolution, scoringStep, startedAt, companyName, tier }: Props) {
  const elapsed = useElapsed(startedAt);
  const overallPct = (() => {
    const MAP: Record<string, number> = { QUEUED: 0, FETCHING: 7, EXPANDING: 21, RESOLVING: 50, SCORING: 78, COMPLETE: 100 };
    return MAP[status] ?? 0;
  })();

  return (
    <div className="h-[calc(100vh-57px)] grid grid-cols-1 lg:grid-cols-12">
      {/* LEFT SIDEBAR */}
      <div className="lg:col-span-3 border-r border-white/5 bg-ink-850 p-6 flex flex-col">
        {/* Company identity */}
        <div className="mb-8">
          <div className="w-10 h-10 rounded-sm bg-ink-50/10 text-ink-50 flex items-center justify-center font-mono text-sm font-bold mb-3">
            {(companyName || '?')[0].toUpperCase()}
          </div>
          <div className="text-base font-medium text-ink-50 leading-snug">{companyName || 'Loading...'}</div>
          {tier && (
            <span className="inline-block mt-2 text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border border-white/10 text-ink-400">
              {tier}
            </span>
          )}
        </div>

        {/* Timer */}
        <div className="mb-8">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">Elapsed</div>
          <div className="text-3xl font-medium text-ink-50 tabular-nums">{formatElapsed(elapsed)}</div>
        </div>

        {/* Overall progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">Overall</div>
            <div className="text-[10px] font-mono text-ink-400 tabular-nums">{overallPct}%</div>
          </div>
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-signal-clean rounded-full transition-all duration-700" style={{ width: `${overallPct}%` }} />
          </div>
        </div>

        {/* Pipeline steps */}
        <div className="flex-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">Pipeline</div>
          <ol className="space-y-0.5">
            {STAGES.map((stage, i) => {
              const ACTIVE_MAP: Record<string, number> = {
                QUEUED: -1, FETCHING: 0, EXPANDING: 1, RESOLVING: 3, SCORING: 5, COMPLETE: 99,
              };
              const activeIdx = ACTIVE_MAP[status] ?? -1;
              const isActive = i === activeIdx;
              const isDone = i < activeIdx;
              return (
                <li key={stage.key} className="flex items-center gap-2.5 py-1.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isDone ? 'bg-signal-clean'
                      : isActive ? 'bg-ink-50 animate-pulse'
                      : 'bg-white/10'
                    }`}
                  />
                  <span className={`text-[11px] ${isActive ? 'text-ink-50' : isDone ? 'text-ink-400' : 'text-ink-600'}`}>
                    {stage.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2 pt-4 border-t border-white/5">
          <div className="w-2 h-2 rounded-full bg-signal-clean animate-pulse shadow-[0_0_12px_rgba(94,230,161,0.7)]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-signal-clean">running</span>
        </div>
      </div>

      {/* RIGHT MAIN */}
      <div className="lg:col-span-9 flex flex-col overflow-hidden">
        {/* Live counters */}
        <div className="border-b border-white/5 bg-ink-900 px-8 py-5">
          <div className="flex items-center gap-10 flex-wrap">
            <LiveStat value={live.entities} label="entities" />
            <LiveStat value={live.edges} label="connections" />
            <LiveStat value={live.matches} label="matches" />
            <LiveStat value={live.apiCalls} label="API calls" />
            <LiveStat value={live.depth} label="depth" />
          </div>

          {/* Resolution progress bar */}
          {resolution && resolution.total > 0 && (
            <div className="mt-5 pt-5 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">
                  Screening against sanctions databases
                </div>
                <div className="text-[10px] font-mono text-ink-400 tabular-nums">
                  {resolution.processed.toLocaleString()} / {resolution.total.toLocaleString()} - {resolution.matches} match{resolution.matches === 1 ? '' : 'es'}
                </div>
              </div>
              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-signal-clean rounded-full transition-all duration-500"
                  style={{ width: `${Math.round((resolution.processed / resolution.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Scoring step */}
          {scoringStep && (
            <div className="mt-5 pt-5 border-t border-white/5 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-signal-clean animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink-50">{scoringStep.step}</div>
                {scoringStep.detail && (
                  <div className="text-[10px] font-mono text-ink-500 mt-0.5">{scoringStep.detail}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sonar visualization - fills remaining space */}
        <div className="flex-1 relative bg-ink-950/30">
          <MiniGraph entities={live.entities} edges={live.edges} />
        </div>
      </div>
    </div>
  );
}

function LiveStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-medium text-ink-50 tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[9px] font-mono text-ink-500 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

/**
 * Sonar / radar visualization. Pulse waves expand from center when new
 * entities are discovered. Blips appear at random positions and flash
 * green when a pulse passes over them.
 */
type Blip = { angle: number; radiusN: number; bornAt: number };
type Pulse = { startedAt: number; intensity: number };

function MiniGraph({ entities, edges }: { entities: number; edges: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });

  const blipsRef = useRef<Blip[]>([]);
  const pulsesRef = useRef<Pulse[]>([]);
  const lastEntitiesRef = useRef(0);
  const lastAutoPulseRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(performance.now());

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const delta = entities - lastEntitiesRef.current;
    if (entities > 0 && (delta > 0 || lastEntitiesRef.current === 0)) {
      const now = performance.now();
      pulsesRef.current.push({
        startedAt: now,
        intensity: Math.min(1, 0.4 + Math.log10((delta || entities) + 1) * 0.3),
      });
      const isInitialSeed = lastEntitiesRef.current === 0 && entities > 10;
      const blipsToAdd = isInitialSeed
        ? Math.min(120, Math.floor(entities / 10))
        : Math.min(25, Math.max(1, Math.ceil(Math.sqrt(delta))));
      for (let i = 0; i < blipsToAdd; i++) {
        const rawR = Math.random();
        blipsRef.current.push({
          angle: Math.random() * Math.PI * 2,
          radiusN: 0.12 + Math.sqrt(rawR) * 0.86,
          bornAt: isInitialSeed ? now - Math.random() * 3000 : now,
        });
      }
      if (blipsRef.current.length > 500) {
        blipsRef.current.splice(0, blipsRef.current.length - 500);
      }
      if (pulsesRef.current.length > 6) {
        pulsesRef.current.splice(0, pulsesRef.current.length - 6);
      }
    }
    lastEntitiesRef.current = entities;
  }, [entities]);

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

      // Auto-pulse every 2s
      if (now - lastAutoPulseRef.current > 2000) {
        lastAutoPulseRef.current = now;
        pulsesRef.current.push({ startedAt: now, intensity: 0.35 });
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

      // Blips - permanent
      const liveBlips: Blip[] = [];
      for (const b of blipsRef.current) {
        const age = now - b.bornAt;
        const alpha = age < BLIP_FADE_IN ? age / BLIP_FADE_IN : 1;
        liveBlips.push(b);

        const r = b.radiusN * maxR;
        const x = cx + Math.cos(b.angle) * r;
        const y = cy + Math.sin(b.angle) * r * 0.62;

        let highlight = 0;
        for (const p of livePulses) {
          const t = (now - p.startedAt) / PULSE_DURATION;
          const pulseR = t * maxR;
          const distFromPulse = Math.abs(pulseR - r);
          if (distFromPulse < 12) {
            highlight = Math.max(highlight, (1 - distFromPulse / 12) * (1 - t));
          }
        }

        const baseAlpha = Math.min(1, alpha * 0.85);
        if (highlight > 0.15) {
          ctx.fillStyle = `rgba(94,230,161,${Math.min(1, baseAlpha + highlight)})`;
          ctx.shadowColor = 'rgba(94,230,161,0.7)';
          ctx.shadowBlur = 6 * highlight;
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
      }
      blipsRef.current = liveBlips;

      // Center node
      const breath = 0.5 + 0.5 * Math.sin((now - startedAtRef.current) / 600);
      ctx.fillStyle = `rgba(94,230,161,${0.12 + breath * 0.1})`;
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(94,230,161,${0.18 + breath * 0.18})`;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#F5F5F5';
      ctx.shadowColor = 'rgba(245,245,245,0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [size, edges]);

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
