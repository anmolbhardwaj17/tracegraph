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
        height={760}
        onNodeClick={setSelected}
      />
    </div>
  );
}
