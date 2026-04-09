'use client';
import { useEffect, useRef, useState } from 'react';

interface Props {
  status: string;
  live: { entities: number; edges: number; depth: number; apiCalls: number; matches: number };
  startedAt?: string;
}

const STAGES = [
  { key: 'FETCHING',  label: 'Fetching company profile',          hint: 'UK Companies House' },
  { key: 'EXPANDING', label: 'Expanding ownership network',       hint: 'Directors · PSC · addresses' },
  { key: 'RESOLVING', label: 'Cross-source matching',             hint: 'OpenSanctions · ICIJ' },
  { key: 'SCORING',   label: 'Detecting anomalies & scoring risk', hint: 'Shell · cycles · proximity' },
];

const ORDER = ['QUEUED', 'FETCHING', 'EXPANDING', 'RESOLVING', 'SCORING', 'COMPLETE'];

export function ProgressView({ status, live, startedAt }: Props) {
  const currentIdx = ORDER.indexOf(status);
  const elapsed = useElapsed(startedAt);
  const stagesDone = Math.max(0, Math.min(STAGES.length, currentIdx - 1));
  const overallPct = Math.min(100, Math.round((stagesDone / STAGES.length) * 100));

  return (
    <div className="space-y-6">
      {/* Elapsed strip · full width, sleek dashboard header */}
      <div className="border border-white/5 bg-ink-850 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Elapsed</div>
            <div className="text-3xl font-medium text-ink-50 tabular-nums mt-1">{formatElapsed(elapsed)}</div>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Stage</div>
            <div className="text-sm text-ink-50 mt-1">
              {currentIdx >= 0 && currentIdx < ORDER.length ? STAGES[Math.max(0, currentIdx - 1)]?.label || 'Queued' : 'Queued'}
            </div>
          </div>
          <div className="h-10 w-px bg-white/10" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Overall</div>
            <div className="text-sm text-ink-50 tabular-nums mt-1">{overallPct}%</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-signal-clean animate-pulse shadow-[0_0_12px_rgba(94,230,161,0.7)]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-signal-clean">running</span>
        </div>
      </div>

      {/* 2-column dashboard: stages left, visualization right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT: stages */}
        <div className="lg:col-span-5 border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-5">/ Pipeline</div>
          <ol>
            {STAGES.map((stage, i) => {
              const stageIdx = ORDER.indexOf(stage.key);
              const isActive = currentIdx === stageIdx;
              const isDone = currentIdx > stageIdx;
              return (
                <li key={stage.key} className="border-b border-white/5 last:border-b-0 py-4 flex items-center gap-4">
                  <div className="text-[10px] font-mono text-ink-500 w-8">/{String(i + 1).padStart(3, '0')}</div>
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isDone
                        ? 'bg-signal-clean'
                        : isActive
                        ? 'bg-ink-50 animate-pulse shadow-[0_0_10px_rgba(245,245,245,0.6)]'
                        : 'bg-white/10'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${isActive ? 'text-ink-50' : isDone ? 'text-ink-300' : 'text-ink-500'}`}>
                      {stage.label}
                    </div>
                    <div className="text-[10px] font-mono text-ink-500 mt-0.5">{stage.hint}</div>
                  </div>
                  {isActive && <span className="text-[10px] font-mono text-ink-400 uppercase tracking-wider">in progress</span>}
                  {isDone && <span className="text-[10px] font-mono text-signal-clean uppercase tracking-wider">complete</span>}
                </li>
              );
            })}
          </ol>
        </div>

        {/* RIGHT: visualization */}
        <div className="lg:col-span-7 border border-white/5 bg-ink-850 flex flex-col">
          <div className="px-6 pt-6">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Network growth</div>
              <div className="text-[10px] font-mono text-ink-500 tabular-nums">
                {live.entities.toLocaleString()} entities · {live.edges.toLocaleString()} connections
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-[360px] relative">
            <MiniGraph entities={live.entities} edges={live.edges} />
          </div>
        </div>
      </div>

      {/* Stats strip · full width */}
      <div className="grid grid-cols-3 md:grid-cols-5 gap-px bg-white/5 border border-white/5">
        <Counter label="Entities" value={live.entities} />
        <Counter label="Connections" value={live.edges} />
        <Counter label="Depth" value={live.depth} />
        <Counter label="API calls" value={live.apiCalls} />
        <Counter label="Matches" value={live.matches} />
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-ink-850 p-5 text-center">
      <div className="text-3xl font-medium text-ink-50 tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-2 font-mono">{label}</div>
    </div>
  );
}

/**
 * Sonar / radar visualization. A pulsing center node represents the target,
 * concentric grid rings define the search field, and blips appear at random
 * positions as entities are discovered. Each new batch triggers an expanding
 * wave from the center. Driven by requestAnimationFrame so the animation is
 * always smooth (60fps) regardless of how often the API polls.
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
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(performance.now());

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ w: rect.width, h: rect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // React to entity count change: spawn blips + a pulse wave
  useEffect(() => {
    const delta = entities - lastEntitiesRef.current;
    if (delta > 0) {
      const now = performance.now();
      // One pulse per detection event, intensity scaled by batch size
      pulsesRef.current.push({
        startedAt: now,
        intensity: Math.min(1, 0.4 + Math.log10(delta + 1) * 0.3),
      });
      // Number of new blips proportional to delta but capped
      const blipsToAdd = Math.min(25, Math.max(1, Math.ceil(Math.sqrt(delta))));
      for (let i = 0; i < blipsToAdd; i++) {
        blipsRef.current.push({
          angle: Math.random() * Math.PI * 2,
          radiusN: 0.18 + Math.random() * 0.78,
          bornAt: now,
        });
      }
      // Cap blips at 240 · recycle oldest
      if (blipsRef.current.length > 240) {
        blipsRef.current.splice(0, blipsRef.current.length - 240);
      }
      // Cap pulses at 6
      if (pulsesRef.current.length > 6) {
        pulsesRef.current.splice(0, pulsesRef.current.length - 6);
      }
    }
    lastEntitiesRef.current = entities;
  }, [entities]);

  // Animation loop (rAF, runs at refresh rate)
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

    const PULSE_DURATION = 2400; // ms
    const BLIP_FADE_IN = 600;
    const BLIP_FADE_OUT_AFTER = 8000;
    const BLIP_FADE_DURATION = 4000;

    function frame() {
      if (!ctx) return;
      const now = performance.now();
      ctx.clearRect(0, 0, W, H);

      // ---- background grid: concentric ellipses ----
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      const RINGS = 5;
      for (let i = 1; i <= RINGS; i++) {
        const r = (maxR * i) / RINGS;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Cross-hairs
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR * 0.62);
      ctx.lineTo(cx, cy + maxR * 0.62);
      ctx.stroke();

      // ---- expanding pulse waves ----
      const livePulses: Pulse[] = [];
      for (const p of pulsesRef.current) {
        const age = now - p.startedAt;
        if (age > PULSE_DURATION) continue;
        livePulses.push(p);
        const t = age / PULSE_DURATION; // 0..1
        const r = t * maxR;
        const alpha = (1 - t) * p.intensity * 0.55;
        // Glow ring
        ctx.strokeStyle = `rgba(94,230,161,${alpha})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Soft second ring trailing slightly
        ctx.strokeStyle = `rgba(94,230,161,${alpha * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * 0.94, r * 0.94 * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      pulsesRef.current = livePulses;

      // ---- blips ----
      const liveBlips: Blip[] = [];
      for (const b of blipsRef.current) {
        const age = now - b.bornAt;
        // Fade in
        let alpha = 1;
        if (age < BLIP_FADE_IN) {
          alpha = age / BLIP_FADE_IN;
        }
        // Fade out after a while
        if (age > BLIP_FADE_OUT_AFTER) {
          const fade = (age - BLIP_FADE_OUT_AFTER) / BLIP_FADE_DURATION;
          alpha = Math.max(0, 1 - fade) * 0.6;
        }
        if (alpha <= 0.02) continue;
        liveBlips.push(b);

        const r = b.radiusN * maxR;
        const x = cx + Math.cos(b.angle) * r;
        const y = cy + Math.sin(b.angle) * r * 0.62;

        // Highlight blips that a pulse is currently passing over (radar sweep)
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
          // Lit by sweep · green flash
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

      // ---- center node (the target company) ----
      // Always-on slow breathing pulse
      const breath = 0.5 + 0.5 * Math.sin((now - startedAtRef.current) / 600);
      ctx.fillStyle = `rgba(94,230,161,${0.12 + breath * 0.1})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(94,230,161,${0.18 + breath * 0.18})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      // Solid core
      ctx.fillStyle = '#F5F5F5';
      ctx.shadowColor = 'rgba(245,245,245,0.8)';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // ---- HUD overlays ----
      // Big entity count, top-left
      ctx.fillStyle = '#F5F5F5';
      ctx.font = '500 28px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const entityText = (lastEntitiesRef.current).toLocaleString();
      ctx.fillText(entityText, 20, 16);
      ctx.fillStyle = '#525252';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('/ ENTITIES', 20 + ctx.measureText(entityText).width + 10, 26);

      // Edges count, top-right
      ctx.fillStyle = '#A0A0A0';
      ctx.font = '500 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const edgeText = edges.toLocaleString();
      ctx.fillText(edgeText, W - 20, 22);
      ctx.fillStyle = '#525252';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('CONNECTIONS /', W - 20 - ctx.measureText(edgeText).width - 10, 24);

      // Status line, bottom-left
      ctx.fillStyle = '#525252';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('● SCANNING NETWORK', 20, H - 14);

      // Active blip count, bottom-right
      ctx.textAlign = 'right';
      ctx.fillText(`${liveBlips.length} VISIBLE`, W - 20, H - 14);

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
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

