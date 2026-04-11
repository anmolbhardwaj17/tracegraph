'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { GraphVisualization, GraphNode } from '../../../../components/GraphVisualization';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function GraphPage() {
  const { id } = useParams() as { id: string };
  const [graph, setGraph] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/graph`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/findings`).then((r) => r.json()),
    ])
      .then(([g, f]) => { setGraph(g); setFindings(f.findings || []); })
      .catch(() => {});
  }, [id]);

  if (!graph) return <div className="animate-pulse h-[760px] bg-white/5 rounded-sm" />;

  return (
    <div className="relative -mx-8 -mt-12">
      <GraphVisualization
        nodes={graph.nodes}
        links={graph.links}
        findings={findings}
        rootNodeId={graph.rootNodeId}
        height={760}
        onNodeClick={setSelected}
      />

      {/* Entity detail panel */}
      {selected && (
        <aside className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] overflow-auto border border-white/10 bg-ink-900/95 backdrop-blur-md p-5 shadow-2xl z-20">
          <div className="flex items-start justify-between mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{selected.entityType}</div>
            <button onClick={() => setSelected(null)} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">x</button>
          </div>
          <h3 className="font-medium text-ink-50 break-words">{selected.label}</h3>

          <dl className="mt-5 space-y-3 text-sm border-t border-white/5 pt-4">
            <Field label="Connections" value={String(selected.degree)} />
            {selected.proximityScore && selected.proximityScore !== 'CLEAR' && (
              <Field label="Proximity" value={selected.proximityScore} highlight />
            )}
            {selected.shellRisk && selected.shellRisk !== 'LOW' && (
              <Field label="Shell risk" value={selected.shellRisk} highlight={selected.shellRisk === 'HIGH' || selected.shellRisk === 'CRITICAL'} />
            )}
            {selected.addressFlag && <Field label="Address flag" value={selected.addressFlag} />}
            {selected.hasMatch && <Field label="Sanctions" value="Match found" highlight />}
            {selected.jurisdictionRisk === 'HIGH' && <Field label="Jurisdiction" value={`${selected.jurisdictionName} (HIGH)`} highlight />}
            {selected.isFormationAgent && <Field label="Type" value="Formation agent" />}
          </dl>

          {selected.metadata && Object.keys(selected.metadata).length > 0 && (
            <details className="mt-5">
              <summary className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 cursor-pointer hover:text-ink-300">/ Raw metadata</summary>
              <pre className="text-[10px] text-ink-400 mt-2 overflow-auto max-h-48 bg-ink-900 p-3 rounded-sm border border-white/5">
                {JSON.stringify(selected.metadata, null, 2)}
              </pre>
            </details>
          )}

          {selected.entityType === 'company' && (
            <a href={`/?q=${selected.label}`} className="mt-5 block text-center text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 border border-white/10 rounded-sm py-2 transition-colors">
              Investigate this company
            </a>
          )}
        </aside>
      )}
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
