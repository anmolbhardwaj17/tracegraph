'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Download, RefreshCw, Edit3, Check, X } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

const REC_CONFIG = {
  PROCEED: { label: 'PROCEED', color: 'text-signal-clean', border: 'border-signal-clean/40', bg: 'bg-signal-clean/8', dot: 'bg-signal-clean' },
  CONDITIONS: { label: 'PROCEED WITH CONDITIONS', color: 'text-signal-medium', border: 'border-signal-medium/40', bg: 'bg-signal-medium/8', dot: 'bg-signal-medium' },
  WALK: { label: 'DO NOT PROCEED', color: 'text-signal-critical', border: 'border-signal-critical/40', bg: 'bg-signal-critical/8', dot: 'bg-signal-critical' },
};

export default function MemoPage() {
  const { id } = useParams() as { id: string };
  const [memo, setMemo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const fetchMemo = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/investigations/${id}/memo`);
      const data = await res.json();
      if (data.memo) {
        setMemo(data.memo);
        setOverrides(data.memo.userOverrides || {});
      }
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchMemo(); }, [fetchMemo]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/investigations/${id}/memo`, { method: 'POST' });
      const data = await res.json();
      if (data.memo) { setMemo(data.memo); setOverrides(data.memo.userOverrides || {}); }
    } catch {}
    setGenerating(false);
  }

  async function saveEdit(key: string) {
    const updated = { ...overrides, [key]: editValue };
    setOverrides(updated);
    setEditingKey(null);
    await fetch(`${API}/api/investigations/${id}/memo/overrides`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides: updated }),
    });
  }

  function startEdit(key: string, current: string) {
    setEditingKey(key);
    setEditValue(overrides[key] ?? current);
  }

  function getField(key: string, fallback: string): string {
    return overrides[key] ?? fallback ?? '';
  }

  async function exportPdf() {
    setExporting(true);
    try {
      const res = await fetch(`${API}/api/investigations/${id}/memo/export`, { method: 'POST' });
      const blob = await res.blob();
      const name = (memo?.companyName || id).replace(/[^a-zA-Z0-9]/g, '_');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `IC_Memo_${name}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {}
    setExporting(false);
  }

  if (loading) return <MemoSkeleton />;

  if (!memo) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center">
          <Edit3 size={24} className="text-ink-500" />
        </div>
        <div className="text-center">
          <div className="text-base font-medium text-ink-50 mb-2">No IC memo generated yet</div>
          <div className="text-sm text-ink-500 max-w-sm leading-relaxed">
            Generate a structured acquisition memo — executive summary, ownership, key people, risk profile, and deal recommendation.
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-2 px-6 py-3 bg-ink-50 text-ink-900 rounded-sm font-medium text-sm hover:bg-white transition-colors disabled:opacity-50"
        >
          {generating ? (
            <><div className="w-4 h-4 border-2 border-ink-900 border-t-transparent rounded-full animate-spin" />Generating memo...</>
          ) : (
            <>Generate IC Memo</>
          )}
        </button>
        {generating && (
          <p className="text-[11px] font-mono text-ink-600">This takes 15-30 seconds. We're analysing the full DD file.</p>
        )}
      </div>
    );
  }

  const rec = REC_CONFIG[memo.recommendation as keyof typeof REC_CONFIG] || REC_CONFIG.CONDITIONS;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">IC Acquisition Memo</div>
          <div className="text-xl font-medium text-ink-50">{memo.companyName}</div>
          <div className="text-[11px] font-mono text-ink-600 mt-1">
            Generated {new Date(memo.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            {memo.lastEditedAt && ` · Edited ${new Date(memo.lastEditedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={generating ? 'animate-spin' : ''} />
            Regenerate
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-white/10 rounded-sm text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 hover:border-white/30 transition-colors disabled:opacity-40"
          >
            {exporting ? <div className="w-3 h-3 border border-ink-400 border-t-transparent rounded-full animate-spin" /> : <Download size={11} />}
            Export PDF
          </button>
        </div>
      </div>

      {/* Recommendation banner */}
      <div className={`flex items-center gap-3 px-5 py-4 border ${rec.border}`} style={{ background: 'rgba(0,0,0,0.2)' }}>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${rec.dot}`} />
        <div className="flex-1">
          <div className={`text-sm font-medium ${rec.color}`}>{rec.label}</div>
          <EditableField
            fieldKey="recommendationRationale"
            value={getField('recommendationRationale', memo.recommendationRationale)}
            editingKey={editingKey}
            editValue={editValue}
            onStartEdit={startEdit}
            onSave={saveEdit}
            onCancel={() => setEditingKey(null)}
            onEditValueChange={setEditValue}
            className="text-xs text-ink-400 mt-1 leading-relaxed"
          />
        </div>
        <div className="text-[10px] font-mono text-ink-600 shrink-0">Risk: {memo.riskScore}/100</div>
      </div>

      {/* Executive Summary */}
      <MemoSection title="Executive Summary">
        <EditableField
          fieldKey="executiveSummary"
          value={getField('executiveSummary', memo.executiveSummary)}
          editingKey={editingKey}
          editValue={editValue}
          onStartEdit={startEdit}
          onSave={saveEdit}
          onCancel={() => setEditingKey(null)}
          onEditValueChange={setEditValue}
          className="text-sm text-ink-200 leading-relaxed"
          multiline
        />
      </MemoSection>

      {/* Target Overview */}
      <MemoSection title="Target Overview">
        <EditableField
          fieldKey="targetOverview.description"
          value={getField('targetOverview.description', memo.targetOverview?.description)}
          editingKey={editingKey}
          editValue={editValue}
          onStartEdit={startEdit}
          onSave={saveEdit}
          onCancel={() => setEditingKey(null)}
          onEditValueChange={setEditValue}
          className="text-sm text-ink-200 leading-relaxed mb-4"
          multiline
        />
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Industry', memo.targetOverview?.industry],
            ['Founded', memo.targetOverview?.founded],
            ['Scale', memo.targetOverview?.scale],
            ['Geographic footprint', memo.targetOverview?.footprint],
          ].filter(([, v]) => v && v !== 'Unknown').map(([label, value]) => (
            <div key={label as string} className="border border-white/5 p-3">
              <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-1">{label}</div>
              <div className="text-xs text-ink-300">{value}</div>
            </div>
          ))}
        </div>
      </MemoSection>

      {/* Ownership & Control */}
      <MemoSection title="Ownership & Control">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 border border-white/10 text-ink-400">
            Complexity: {memo.ownershipControl?.complexityRating || 'Unknown'}
          </span>
        </div>
        <EditableField
          fieldKey="ownershipControl.summary"
          value={getField('ownershipControl.summary', memo.ownershipControl?.summary)}
          editingKey={editingKey}
          editValue={editValue}
          onStartEdit={startEdit}
          onSave={saveEdit}
          onCancel={() => setEditingKey(null)}
          onEditValueChange={setEditValue}
          className="text-sm text-ink-200 leading-relaxed mb-3"
          multiline
        />
        {memo.ownershipControl?.keyPoints?.length > 0 && (
          <ul className="space-y-1.5">
            {memo.ownershipControl.keyPoints.map((point: string, i: number) => (
              <li key={i} className="flex gap-2 text-xs text-ink-400 leading-relaxed">
                <span className="text-ink-600 shrink-0 mt-0.5">—</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </MemoSection>

      {/* Key People */}
      {memo.keyPeople?.length > 0 && (
        <MemoSection title="Key People">
          <div className="space-y-4">
            {memo.keyPeople.map((person: any, i: number) => (
              <div key={i} className="border border-white/5 p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-ink-50">{person.name}</div>
                    <div className="text-[10px] font-mono text-ink-500 mt-0.5">{person.role}</div>
                  </div>
                  {person.flags?.length > 0 && (
                    <div className="flex gap-1 flex-wrap justify-end">
                      {person.flags.map((f: string) => (
                        <span key={f} className="text-[7px] font-mono uppercase px-1.5 py-0.5 rounded-sm border bg-signal-critical/15 text-signal-critical border-signal-critical/30">
                          {f.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-ink-400 leading-relaxed">{person.trackRecord}</p>
              </div>
            ))}
          </div>
        </MemoSection>
      )}

      {/* Risk Profile */}
      <MemoSection title="Risk Profile">
        <div className="space-y-4">
          {memo.riskProfile?.dealBlockers?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-signal-critical mb-2">Deal Blockers</div>
              <ul className="space-y-1.5">
                {memo.riskProfile.dealBlockers.map((b: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-signal-critical/80 leading-relaxed">
                    <span className="shrink-0 mt-0.5">✕</span><span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {memo.riskProfile?.yellowFlags?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-signal-medium mb-2">Yellow Flags</div>
              <ul className="space-y-1.5">
                {memo.riskProfile.yellowFlags.map((f: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-signal-medium/80 leading-relaxed">
                    <span className="shrink-0 mt-0.5">△</span><span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {memo.riskProfile?.cleanSignals?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-signal-clean mb-2">Clean Signals</div>
              <ul className="space-y-1.5">
                {memo.riskProfile.cleanSignals.map((s: string, i: number) => (
                  <li key={i} className="flex gap-2 text-xs text-signal-clean/80 leading-relaxed">
                    <span className="shrink-0 mt-0.5">✓</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </MemoSection>

      {/* Financial Snapshot */}
      <MemoSection title="Financial Snapshot">
        <EditableField
          fieldKey="financialSnapshot.summary"
          value={getField('financialSnapshot.summary', memo.financialSnapshot?.summary)}
          editingKey={editingKey}
          editValue={editValue}
          onStartEdit={startEdit}
          onSave={saveEdit}
          onCancel={() => setEditingKey(null)}
          onEditValueChange={setEditValue}
          className="text-sm text-ink-200 leading-relaxed"
          multiline
        />
      </MemoSection>

      {/* Next-Step DD Scope */}
      {memo.nextStepDDScope?.length > 0 && (
        <MemoSection title="Recommended DD Scope">
          <ul className="space-y-2">
            {memo.nextStepDDScope.map((item: string, i: number) => (
              <li key={i} className="flex gap-3 text-xs text-ink-300 leading-relaxed">
                <span className="text-[9px] font-mono text-ink-600 shrink-0 mt-0.5 w-4">{String(i + 1).padStart(2, '0')}</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </MemoSection>
      )}
    </div>
  );
}

function MemoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/5 bg-ink-850">
      <div className="px-5 py-3 border-b border-white/5">
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

interface EditableFieldProps {
  fieldKey: string;
  value: string;
  editingKey: string | null;
  editValue: string;
  onStartEdit: (key: string, current: string) => void;
  onSave: (key: string) => void;
  onCancel: () => void;
  onEditValueChange: (v: string) => void;
  className?: string;
  multiline?: boolean;
}

function EditableField({ fieldKey, value, editingKey, editValue, onStartEdit, onSave, onCancel, onEditValueChange, className = '', multiline }: EditableFieldProps) {
  const isEditing = editingKey === fieldKey;

  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          className="w-full bg-ink-800 border border-white/15 rounded-sm text-sm text-ink-100 px-3 py-2 resize-none focus:outline-none focus:border-white/30"
          rows={multiline ? 4 : 2}
          autoFocus
        />
        <div className="flex gap-2">
          <button onClick={() => onSave(fieldKey)} className="flex items-center gap-1 text-[10px] font-mono text-signal-clean border border-signal-clean/30 px-2 py-1 rounded-sm hover:bg-signal-clean/10 transition-colors">
            <Check size={10} />Save
          </button>
          <button onClick={onCancel} className="flex items-center gap-1 text-[10px] font-mono text-ink-500 border border-white/10 px-2 py-1 rounded-sm hover:bg-white/5 transition-colors">
            <X size={10} />Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative cursor-text ${className}`}
      onClick={() => onStartEdit(fieldKey, value)}
      title="Click to edit"
    >
      <span>{value || <span className="text-ink-600 italic">Empty — click to add</span>}</span>
      <Edit3 size={10} className="absolute -top-0.5 -right-4 text-ink-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function MemoSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
      <div className="h-16 bg-white/5 rounded-sm" />
      <div className="h-12 bg-white/5 rounded-sm" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="border border-white/5">
          <div className="h-9 bg-white/5 border-b border-white/5" />
          <div className="p-5 space-y-2">
            <div className="h-4 bg-white/5 rounded-sm w-3/4" />
            <div className="h-4 bg-white/5 rounded-sm" />
            <div className="h-4 bg-white/5 rounded-sm w-5/6" />
          </div>
        </div>
      ))}
    </div>
  );
}
