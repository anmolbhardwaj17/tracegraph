'use client';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
  jurisdictionRisk?: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  jurisdictionName?: string;
  isFormationAgent?: boolean;
  metadata?: any;
}
export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

export interface GraphFinding {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  affectedEntities: string[];
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  findings?: GraphFinding[];
  height?: number;
  onNodeClick?: (n: GraphNode | null) => void;
}

const TYPE_COLOR: Record<string, string> = {
  company: '#F5C518',
  person: '#5EE6A1',
  address: '#737373',
};
const ROOT_COLOR = '#FFFFFF';
const RISK_RED = '#FF4D4D';
const RISK_AMBER = '#FF8A3D';

function isRisky(n: GraphNode): 'critical' | 'warning' | null {
  if (n.shellRisk === 'CRITICAL' || n.proximityScore === 'CRITICAL' || n.hasMatch) return 'critical';
  if (n.shellRisk === 'HIGH' || n.proximityScore === 'HIGH') return 'critical';
  if (n.shellRisk === 'MEDIUM' || n.proximityScore === 'MEDIUM' || n.addressFlag === 'HIGH_DENSITY') return 'warning';
  return null;
}

function nodeRadius(n: GraphNode, isRoot: boolean, depth: number): number {
  if (isRoot) return 18;
  if (depth <= 2) return Math.max(6, Math.min(14, 5 + Math.sqrt(n.degree || 1) * 2));
  return Math.max(4, Math.min(12, 3 + Math.sqrt(n.degree || 1) * 1.5));
}

export function GraphVisualization({ nodes, links, findings = [], height = 720, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [depth, setDepth] = useState(1);
  const [showRisk, setShowRisk] = useState(false);
  const [search, setSearch] = useState('');
  const [legendOpen, setLegendOpen] = useState(true);
  const [hideFormationAgents, setHideFormationAgents] = useState(true);

  // Find root
  const rootId = useMemo(() => {
    if (nodes.length === 0) return '';
    return [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0))[0].id;
  }, [nodes]);

  // Adjacency
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
      adj.get(s)?.add(t);
      adj.get(t)?.add(s);
    }
    return adj;
  }, [nodes, links]);

  // Compute depth layers from root
  const { depthMap, depth1Ids, depth2Ids } = useMemo(() => {
    const dm = new Map<string, number>();
    if (!rootId) return { depthMap: dm, depth1Ids: new Set<string>(), depth2Ids: new Set<string>() };
    dm.set(rootId, 0);
    const queue = [rootId];
    while (queue.length) {
      const cur = queue.shift()!;
      const curDepth = dm.get(cur)!;
      for (const nb of adjacency.get(cur) || []) {
        if (!dm.has(nb)) {
          dm.set(nb, curDepth + 1);
          queue.push(nb);
        }
      }
    }
    const d1 = new Set<string>();
    const d2 = new Set<string>();
    for (const [id, d] of dm) {
      if (d <= 1) d1.add(id);
      if (d <= 2) d2.add(id);
    }
    return { depthMap: dm, depth1Ids: d1, depth2Ids: d2 };
  }, [rootId, adjacency]);

  // Visible set based on depth slider
  const { visibleNodes, visibleLinks } = useMemo(() => {
    let allowedIds: Set<string>;
    if (depth === 1) allowedIds = depth1Ids;
    else if (depth === 2) allowedIds = depth2Ids;
    else allowedIds = new Set(nodes.map((n) => n.id)); // full

    let pool = nodes.filter((n) => allowedIds.has(n.id));
    if (hideFormationAgents) pool = pool.filter((n) => !n.isFormationAgent);
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter((n) => n.label?.toLowerCase().includes(q) || n.id === rootId);
    }

    // Cap at 400 for full view
    if (depth >= 3 && pool.length > 400) {
      const sorted = [...pool].sort((a, b) => (b.degree || 0) - (a.degree || 0));
      pool = sorted.slice(0, 400);
      if (!pool.find((n) => n.id === rootId)) {
        const r = nodes.find((n) => n.id === rootId);
        if (r) pool.push(r);
      }
    }

    const visSet = new Set(pool.map((n) => n.id));
    const vLinks = links.filter((l) => {
      const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
      return visSet.has(s) && visSet.has(t);
    });

    return { visibleNodes: pool, visibleLinks: vLinks };
  }, [nodes, links, depth, depth1Ids, depth2Ids, rootId, hideFormationAgents, search]);

  // D3 render
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const width = containerRef.current?.clientWidth || 800;
    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    // Background
    const defs = svg.append('defs');
    const radial = defs.append('radialGradient').attr('id', 'bg-r').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    radial.append('stop').attr('offset', '0%').attr('stop-color', '#171717');
    radial.append('stop').attr('offset', '100%').attr('stop-color', '#0A0A0A');
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'url(#bg-r)');

    const root = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 5]).on('zoom', (e) => root.attr('transform', e.transform.toString()));
    svg.call(zoom as any);

    if (visibleNodes.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;

    // Clone nodes for simulation
    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    const idMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: GraphLink[] = visibleLinks
      .map((l) => ({
        ...l,
        source: idMap.get(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id) || l.source,
        target: idMap.get(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id) || l.target,
      }))
      .filter((l) => typeof l.source !== 'string' && typeof l.target !== 'string');

    // Structured initial positions for depth 1-2
    const rootSim = simNodes.find((n) => n.id === rootId);
    if (rootSim) { rootSim.fx = cx; rootSim.fy = cy; }

    if (depth <= 2) {
      const directors = simNodes.filter((n) => n.id !== rootId && n.entityType === 'person');
      const companies = simNodes.filter((n) => n.id !== rootId && n.entityType === 'company');
      const addresses = simNodes.filter((n) => n.entityType === 'address');

      // Directors in inner ring
      const dirRadius = Math.min(width, height) * 0.22;
      directors.forEach((d, i) => {
        const angle = (i / Math.max(directors.length, 1)) * Math.PI * 2 - Math.PI / 2;
        d.x = cx + Math.cos(angle) * dirRadius;
        d.y = cy + Math.sin(angle) * dirRadius;
      });

      // Companies in outer ring
      const compRadius = Math.min(width, height) * 0.38;
      companies.forEach((c, i) => {
        const angle = (i / Math.max(companies.length, 1)) * Math.PI * 2 - Math.PI / 2;
        c.x = cx + Math.cos(angle) * compRadius;
        c.y = cy + Math.sin(angle) * compRadius;
      });

      // Addresses at bottom
      addresses.forEach((a, i) => {
        a.x = cx - (addresses.length * 20) / 2 + i * 40;
        a.y = cy + Math.min(width, height) * 0.4;
      });
    }

    const sim = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id((d) => d.id).distance(depth <= 2 ? 100 : 80).strength(0.3))
      .force('charge', d3.forceManyBody().strength((d: any) => depth <= 2 ? -200 : -150 - (d.degree || 1) * 3))
      .force('center', d3.forceCenter(cx, cy).strength(0.03))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d, d.id === rootId, depth) + 4));

    if (depth <= 2) sim.alpha(0.5); // Gentler for structured layout

    const searchQ = search.toLowerCase().trim();
    const matchSet = new Set<string>();
    if (searchQ) for (const n of simNodes) if (n.label?.toLowerCase().includes(searchQ)) matchSet.add(n.id);

    // Edges
    const linkSel = root.append('g').attr('stroke-linecap', 'round').selectAll('line').data(simLinks).enter().append('line')
      .attr('stroke', (d) => d.type === 'address' ? 'rgba(115,115,115,0.18)' : d.type === 'psc' ? 'rgba(245,197,24,0.35)' : 'rgba(94,230,161,0.22)')
      .attr('stroke-width', (d) => d.type === 'psc' ? 1.6 : 1)
      .attr('stroke-dasharray', (d) => d.type === 'address' ? '3,3' : d.type === 'psc' ? '4,3' : (null as any))
      .attr('opacity', 0.75);

    // Node groups
    const nodeGroup = root.append('g').selectAll('g').data(simNodes).enter().append('g').style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); if (d.id !== rootId) { d.fx = null; d.fy = null; } }) as any)
      .on('mouseenter', (event, d) => {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d });
        const nbs = adjacency.get(d.id) || new Set();
        nodeGroup.transition().duration(120).attr('opacity', (n) => n.id === d.id || nbs.has(n.id) ? 1 : 0.1);
        linkSel.transition().duration(120).attr('opacity', (l) => {
          const s = (l.source as GraphNode).id; const t = (l.target as GraphNode).id;
          return s === d.id || t === d.id ? 1 : 0.04;
        }).attr('stroke-width', (l) => {
          const s = (l.source as GraphNode).id; const t = (l.target as GraphNode).id;
          return (s === d.id || t === d.id) ? 3 : 1;
        });
      })
      .on('mouseleave', () => {
        setTooltip(null);
        nodeGroup.transition().duration(120).attr('opacity', 1);
        linkSel.transition().duration(120).attr('opacity', 0.75).attr('stroke-width', (d) => d.type === 'psc' ? 1.6 : 1);
      })
      .on('click', (e, d) => { e.stopPropagation(); onNodeClick?.(d); });

    // Risk halos (only when risk overlay is on)
    if (showRisk) {
      nodeGroup.filter((d) => isRisky(d) !== null).append('circle')
        .attr('r', (d) => nodeRadius(d, d.id === rootId, depth) + 6)
        .attr('fill', 'none')
        .attr('stroke', (d) => isRisky(d) === 'critical' ? RISK_RED : RISK_AMBER)
        .attr('stroke-width', 1.5).attr('opacity', 0.6);
    }

    // Main circles
    nodeGroup.append('circle')
      .attr('r', (d) => nodeRadius(d, d.id === rootId, depth))
      .attr('fill', (d) => d.id === rootId ? ROOT_COLOR : TYPE_COLOR[d.entityType] || '#94A3B8')
      .attr('stroke', (d) => {
        if (showRisk) { const r = isRisky(d); if (r === 'critical') return RISK_RED; if (r === 'warning') return RISK_AMBER; }
        return d.id === rootId ? '#FFFFFF' : 'rgba(0,0,0,0.3)';
      })
      .attr('stroke-width', (d) => d.id === rootId ? 2 : 0.5);

    // Search highlight
    if (matchSet.size > 0) {
      nodeGroup.filter((d) => matchSet.has(d.id)).append('circle')
        .attr('r', (d) => nodeRadius(d, d.id === rootId, depth) + 8)
        .attr('fill', 'none').attr('stroke', '#FFFFFF').attr('stroke-width', 1.5).attr('opacity', 0.8).attr('stroke-dasharray', '3,2');
    }

    // Labels - always show at depth 1-2, only large nodes at full
    const showLabel = (d: GraphNode) => {
      if (d.id === rootId) return true;
      if (depth <= 2) return true;
      return nodeRadius(d, false, depth) >= 8 || matchSet.has(d.id);
    };
    nodeGroup.filter(showLabel).append('text')
      .text((d) => d.label.length > (depth <= 2 ? 30 : 20) ? d.label.slice(0, depth <= 2 ? 28 : 18) + '...' : d.label)
      .attr('font-size', (d) => d.id === rootId ? 12 : depth <= 2 ? 10 : 9)
      .attr('font-weight', (d) => d.id === rootId ? 600 : 400)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => nodeRadius(d, d.id === rootId, depth) + 14)
      .attr('fill', (d) => d.id === rootId ? '#FFFFFF' : '#A0A0A0')
      .attr('font-family', 'ui-monospace, monospace')
      .attr('pointer-events', 'none');

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x!).attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!).attr('y2', (d) => (d.target as GraphNode).y!);
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    svg.on('click', () => onNodeClick?.(null));
    return () => { sim.stop(); };
  }, [visibleNodes, visibleLinks, height, onNodeClick, adjacency, rootId, depth, showRisk, search]);

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={containerRef} className="w-full h-full bg-ink-900 border border-white/5 overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />
      </div>

      {/* Depth controls - top center */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm overflow-hidden">
        {[
          { d: 1, label: 'Direct' },
          { d: 2, label: 'Extended' },
          { d: 3, label: 'Full network' },
        ].map((item) => (
          <button key={item.d} onClick={() => setDepth(item.d)}
            className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 transition-colors ${depth === item.d ? 'bg-white/10 text-ink-50' : 'text-ink-500 hover:text-ink-200'}`}>
            {item.label}
          </button>
        ))}
      </div>

      {/* Toolbar - top right */}
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm px-2 py-1.5">
          <input type="text" placeholder="search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-32 bg-transparent text-xs text-ink-50 placeholder:text-ink-600 focus:outline-none px-1" />
          <button onClick={() => setShowRisk(!showRisk)}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border transition-colors ${showRisk ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' : 'text-ink-500 border-white/10'}`}>
            risk
          </button>
          <button onClick={() => setHideFormationAgents(!hideFormationAgents)}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border transition-colors ${hideFormationAgents ? 'text-ink-500 border-white/10' : 'bg-white/10 text-ink-50 border-white/30'}`}>
            agents
          </button>
          <button onClick={() => { setDepth(1); setSearch(''); setShowRisk(false); }}
            className="text-[9px] font-mono text-ink-500 hover:text-ink-50 px-1 transition-colors">
            reset
          </button>
        </div>
      </div>

      {/* Legend - bottom left */}
      {legendOpen && (
        <div className="absolute bottom-3 left-3 z-10 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm p-3 text-[9px] font-mono text-ink-500 space-y-1.5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-ink-400 uppercase tracking-wider">Legend</span>
            <button onClick={() => setLegendOpen(false)} className="text-ink-600 hover:text-ink-50">x</button>
          </div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-white shrink-0" /> Target company</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#F5C518' }} /> Other companies</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#5EE6A1' }} /> Directors / People</div>
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#737373' }} /> Addresses</div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-signal-critical shrink-0" /> Risk signal</div>
          <div className="border-t border-white/5 pt-1.5 mt-1.5 space-y-1">
            <div className="flex items-center gap-2"><span className="w-4 h-px bg-signal-clean/40" /> Director</div>
            <div className="flex items-center gap-2"><span className="w-4 h-px bg-signal-medium border-t border-dashed" /> Ownership</div>
            <div className="flex items-center gap-2"><span className="w-4 h-px border-t border-dotted border-ink-400" /> Address</div>
          </div>
        </div>
      )}
      {!legendOpen && (
        <button onClick={() => setLegendOpen(true)} className="absolute bottom-3 left-3 z-10 text-[9px] font-mono text-ink-600 hover:text-ink-50 bg-ink-900/80 px-2 py-1 border border-white/10 rounded-sm">
          legend
        </button>
      )}

      {/* Node count */}
      <div className="absolute bottom-3 right-3 z-10 text-[9px] font-mono text-ink-600">
        {visibleNodes.length} nodes - {visibleLinks.length} edges
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute pointer-events-none bg-ink-900 border border-white/10 text-ink-50 text-xs rounded-sm px-3 py-2 shadow-2xl max-w-xs z-20"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
          <div className="font-medium">{tooltip.node.label}</div>
          <div className="text-ink-500 text-[10px] uppercase tracking-wider mt-0.5 font-mono">
            {tooltip.node.entityType} - {tooltip.node.degree} connections
          </div>
          {tooltip.node.shellRisk && tooltip.node.shellRisk !== 'LOW' && (
            <div className="mt-1 text-signal-medium font-mono text-[10px]">SHELL: {tooltip.node.shellRisk}</div>
          )}
          {tooltip.node.hasMatch && (
            <div className="mt-1 text-signal-critical font-mono text-[10px]">SANCTIONS MATCH</div>
          )}
          {tooltip.node.jurisdictionRisk === 'HIGH' && (
            <div className="mt-1 text-signal-critical font-mono text-[10px]">{tooltip.node.jurisdictionName} (HIGH RISK)</div>
          )}
        </div>
      )}

      {visibleNodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm font-mono">
          / no entities match
        </div>
      )}
    </div>
  );
}
