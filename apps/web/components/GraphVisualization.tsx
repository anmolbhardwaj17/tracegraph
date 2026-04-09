'use client';
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  entityType: 'company' | 'person' | 'address';
  label: string;
  degree: number;
  proximityScore?: string;
  shellRisk?: string;
  hasMatch?: boolean;
  addressFlag?: string;
  metadata?: any;
}
export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  height?: number;
  onNodeClick?: (n: GraphNode) => void;
}

const TYPE_COLOR: Record<string, string> = {
  company: '#3B82F6',
  person: '#10B981',
  address: '#6B7280',
};

function riskBorder(n: GraphNode): string | null {
  if (n.shellRisk === 'HIGH' || n.proximityScore === 'CRITICAL' || n.proximityScore === 'HIGH' || n.hasMatch) {
    return '#DC2626';
  }
  if (n.shellRisk === 'MEDIUM' || n.proximityScore === 'MEDIUM' || n.addressFlag === 'HIGH_DENSITY') {
    return '#F59E0B';
  }
  return null;
}

export function GraphVisualization({ nodes, links, height = 600, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const width = containerRef.current?.clientWidth || 800;

    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const root = svg.append('g');

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => root.attr('transform', e.transform.toString()));
    svg.call(zoom as any);

    // Clone nodes/links so D3 can mutate
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
    const idMap = new Map(simNodes.map((n) => [n.id, n] as const));
    const simLinks: GraphLink[] = links
      .map((l) => ({
        ...l,
        source: idMap.get(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id) || l.source,
        target: idMap.get(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id) || l.target,
      }))
      .filter((l) => typeof l.source !== 'string' && typeof l.target !== 'string');

    const sim = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d) + 4));

    const linkSel = root
      .append('g')
      .attr('stroke-linecap', 'round')
      .selectAll('line')
      .data(simLinks)
      .enter()
      .append('line')
      .attr('stroke', (d) => (d.type === 'address' ? '#D1D5DB' : '#94A3B8'))
      .attr('stroke-width', (d) => (d.type === 'psc' ? 2 : 1.2))
      .attr('stroke-dasharray', (d) => {
        if (d.type === 'psc') return '6,4';
        if (d.type === 'address') return '2,3';
        return null as any;
      })
      .attr('opacity', 0.7);

    const nodeGroup = root
      .append('g')
      .selectAll('g')
      .data(simNodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          }) as any,
      )
      .on('mouseenter', (event, d) => {
        const rect = (containerRef.current as HTMLDivElement).getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d });
      })
      .on('mouseleave', () => setTooltip(null))
      .on('click', (_e, d) => onNodeClick?.(d));

    nodeGroup
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => TYPE_COLOR[d.entityType] || '#94A3B8')
      .attr('stroke', (d) => riskBorder(d) || '#FFFFFF')
      .attr('stroke-width', (d) => (riskBorder(d) ? 3 : 1.5));

    nodeGroup
      .append('text')
      .text((d) => (d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label))
      .attr('font-size', 10)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => nodeRadius(d) + 12)
      .attr('fill', '#475569')
      .attr('pointer-events', 'none');

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => { sim.stop(); };
  }, [nodes, links, height, onNodeClick]);

  return (
    <div ref={containerRef} className="relative w-full bg-slate-50 rounded-lg border border-slate-200" style={{ height }}>
      <svg ref={svgRef} className="w-full h-full" />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl max-w-xs"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold">{tooltip.node.label}</div>
          <div className="text-slate-300 text-[10px] uppercase tracking-wider mt-0.5">{tooltip.node.entityType}</div>
          {tooltip.node.shellRisk && tooltip.node.shellRisk !== 'LOW' && (
            <div className="mt-1 text-amber-300">Shell risk: {tooltip.node.shellRisk}</div>
          )}
          {tooltip.node.proximityScore && tooltip.node.proximityScore !== 'CLEAR' && (
            <div className="mt-1 text-red-300">
              {tooltip.node.proximityScore} proximity
            </div>
          )}
          {tooltip.node.hasMatch && <div className="mt-1 text-red-300">Sanctions match</div>}
          {tooltip.node.addressFlag && tooltip.node.addressFlag !== 'NORMAL' && (
            <div className="mt-1 text-amber-300">{tooltip.node.addressFlag}</div>
          )}
        </div>
      )}

      <Legend />
    </div>
  );
}

function nodeRadius(n: GraphNode): number {
  return Math.max(5, Math.min(18, 5 + Math.sqrt(n.degree || 1) * 2));
}

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-sm rounded-lg border border-slate-200 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Company</div>
      <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Person</div>
      <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-slate-500" /> Address</div>
      <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full border-2 border-red-600 bg-white" /> Risk</div>
    </div>
  );
}
