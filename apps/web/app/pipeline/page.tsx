'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Plus, Filter } from 'lucide-react';
import { NavBar } from '../../components/NavBar';
import { Avatar } from '../../components/Avatar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const STAGES = [
  { key: 'TARGETING',      label: 'Targeting',      short: 'Targeting' },
  { key: 'INITIAL_SCREEN', label: 'Initial Screen', short: 'Screen' },
  { key: 'MEETING',        label: 'Meeting',         short: 'Meeting' },
  { key: 'DD',             label: 'Due Diligence',   short: 'DD' },
  { key: 'IOI',            label: 'IOI',             short: 'IOI' },
  { key: 'LOI',            label: 'LOI',             short: 'LOI' },
  { key: 'CLOSING',        label: 'Closing',         short: 'Closing' },
  { key: 'CLOSED_WON',     label: 'Won',             short: 'Won' },
  { key: 'CLOSED_LOST',    label: 'Lost',            short: 'Lost' },
];

const PRIORITY_CONFIG = {
  HIGH:   { label: 'High',   color: 'text-signal-critical', dot: 'bg-signal-critical' },
  NORMAL: { label: 'Normal', color: 'text-ink-500',         dot: 'bg-ink-600' },
  LOW:    { label: 'Low',    color: 'text-ink-600',         dot: 'bg-ink-700' },
};

const RISK_COLOR: Record<string, string> = {
  CRITICAL: 'text-signal-critical',
  HIGH:     'text-signal-high',
  MEDIUM:   'text-signal-medium',
  LOW:      'text-signal-clean',
};

export default function PipelinePage() {
  const [columns, setColumns] = useState<Record<string, any[]>>({});
  const [stats, setStats] = useState<any>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const loadKanban = useCallback(async () => {
    const res = await fetch(`${API}/api/pipeline/kanban`);
    const data = await res.json();
    setColumns(data.columns || {});
  }, []);

  useEffect(() => {
    loadKanban();
    fetch(`${API}/api/pipeline/stats`).then(r => r.json()).then(setStats).catch(() => {});
  }, [loadKanban]);

  async function moveCard(id: string, toStage: string) {
    setColumns(prev => {
      const next = { ...prev };
      let card: any = null;
      for (const stage of Object.keys(next)) {
        const idx = next[stage].findIndex((c: any) => c.id === id);
        if (idx !== -1) { card = next[stage][idx]; next[stage] = next[stage].filter((_: any, i: number) => i !== idx); break; }
      }
      if (card) next[toStage] = [{ ...card, dealStage: toStage }, ...(next[toStage] || [])];
      return next;
    });
    await fetch(`${API}/api/pipeline/${id}/stage`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: toStage }),
    });
  }

  const visibleStages = showClosed ? STAGES : STAGES.filter(s => s.key !== 'CLOSED_WON' && s.key !== 'CLOSED_LOST');
  const totalActive = Object.values(columns).flat().filter((c: any) => c.dealStage !== 'CLOSED_WON' && c.dealStage !== 'CLOSED_LOST').length;

  return (
    <main className="min-h-screen">
      <NavBar />
      <div className="px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-medium text-ink-50">Deal Pipeline</h1>
            <p className="text-xs font-mono text-ink-500 mt-0.5">{totalActive} active deal{totalActive !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-3">
            {stats && (
              <div className="flex items-center gap-4 text-[10px] font-mono text-ink-500 border border-white/5 px-4 py-2">
                <span>Won: <span className="text-signal-clean">{stats.wonCount}</span></span>
                <span>Lost: <span className="text-signal-critical">{stats.lostCount}</span></span>
                {stats.staleCount > 0 && <span>Stale: <span className="text-signal-medium">{stats.staleCount}</span></span>}
              </div>
            )}
            <button
              onClick={() => setShowClosed(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 border border-white/10 text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors"
            >
              <Filter size={11} />
              {showClosed ? 'Hide closed' : 'Show closed'}
            </button>
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-2 bg-ink-50 text-ink-900 text-[10px] font-mono uppercase tracking-wider hover:bg-white transition-colors"
            >
              <Plus size={11} />
              New investigation
            </Link>
          </div>
        </div>

        {/* Kanban board */}
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 180px)' }}>
          {visibleStages.map(stage => {
            const cards: any[] = columns[stage.key] || [];
            const isOver = dragOver === stage.key;
            return (
              <div
                key={stage.key}
                className={`flex-shrink-0 w-[220px] flex flex-col transition-colors ${isOver ? 'bg-white/[0.02]' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(stage.key); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(null);
                  if (dragId) moveCard(dragId, stage.key);
                  setDragId(null);
                }}
              >
                {/* Column header */}
                <div className={`px-3 py-2.5 border-b-2 mb-3 ${isOver ? 'border-[#d4ff00]/40' : 'border-white/5'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-400">{stage.label}</span>
                    <span className="text-[9px] font-mono text-ink-600 bg-white/5 px-1.5 py-0.5 rounded-sm">{cards.length}</span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 flex-1">
                  {cards.map((card: any) => (
                    <DealCard
                      key={card.id}
                      card={card}
                      onDragStart={() => setDragId(card.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    />
                  ))}
                  {cards.length === 0 && (
                    <div className={`border border-dashed border-white/5 rounded-sm p-3 text-center transition-colors ${isOver ? 'border-[#d4ff00]/20 bg-[#d4ff00]/5' : ''}`}>
                      <span className="text-[9px] font-mono text-ink-700">Drop here</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function DealCard({ card, onDragStart, onDragEnd }: { card: any; onDragStart: () => void; onDragEnd: () => void }) {
  const pri = PRIORITY_CONFIG[card.dealPriority as keyof typeof PRIORITY_CONFIG] || PRIORITY_CONFIG.NORMAL;
  const riskColor = RISK_COLOR[card.riskClassification] || 'text-ink-400';
  const daysSince = Math.floor((Date.now() - new Date(card.createdAt).getTime()) / 86400000);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group border border-white/5 bg-ink-850 p-3 cursor-grab active:cursor-grabbing hover:border-white/15 transition-colors"
    >
      <div className="flex items-start gap-2 mb-2">
        <Avatar name={card.companyName} type="company" size={20} />
        <div className="flex-1 min-w-0">
          <Link
            href={`/investigate/${card.id}/overview`}
            className="text-xs font-medium text-ink-100 hover:text-ink-50 transition-colors leading-tight block truncate"
            onClick={e => e.stopPropagation()}
          >
            {card.companyName}
          </Link>
        </div>
        {card.dealPriority === 'HIGH' && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-0.5 ${pri.dot}`} title="High priority" />
        )}
      </div>

      <div className="flex items-center justify-between mt-2">
        {card.riskScore != null ? (
          <span className={`text-[10px] font-mono ${riskColor}`}>{card.riskScore}</span>
        ) : (
          <span className="text-[10px] font-mono text-ink-700">{card.status === 'COMPLETE' ? '—' : card.status.toLowerCase()}</span>
        )}
        {card.dealSizeEstimate && (
          <span className="text-[9px] font-mono text-ink-600">
            {card.dealSizeEstimate >= 1_000_000
              ? `£${(card.dealSizeEstimate / 1_000_000).toFixed(0)}M`
              : `£${(card.dealSizeEstimate / 1_000).toFixed(0)}K`}
          </span>
        )}
        <span className="text-[9px] font-mono text-ink-700">{daysSince}d</span>
      </div>

      {card.dealOwnerName && (
        <div className="text-[9px] font-mono text-ink-600 mt-1.5 truncate">{card.dealOwnerName}</div>
      )}
    </div>
  );
}
