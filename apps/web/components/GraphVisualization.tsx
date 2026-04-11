'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const TYPE_COLOR: Record<string, string> = { company: '#F5C518', person: '#5EE6A1', address: '#737373' };
const ROOT_COLOR = '#FFFFFF';
const RISK_RED = '#FF4D4D';

function isRisky(n: GraphNode): boolean {
  return !!(n.shellRisk === 'CRITICAL' || n.shellRisk === 'HIGH' || n.proximityScore === 'CRITICAL' || n.proximityScore === 'HIGH' || n.hasMatch);
}

type ViewMode = 'questions' | 'ownership' | 'directors' | 'suspicious' | 'path' | 'full' | 'spotlight';

export function GraphVisualization({ nodes, links, findings = [], height = 720, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [mode, setMode] = useState<ViewMode>('questions');
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showRisk, setShowRisk] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const rootId = useMemo(() => {
    if (nodes.length === 0) return '';
    return [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0))[0].id;
  }, [nodes]);

  const rootNode = nodes.find((n) => n.id === rootId);

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

  const labelToNode = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) if (n.label) m.set(n.label.toLowerCase().trim(), n);
    return m;
  }, [nodes]);

  // BFS shortest path
  function findPath(fromId: string, toId: string): string[] | null {
    const parent = new Map<string, string | null>();
    parent.set(fromId, null);
    const queue = [fromId];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur === toId) {
        const path: string[] = [];
        let c: string | null = toId;
        while (c) { path.unshift(c); c = parent.get(c) || null; }
        return path;
      }
      for (const nb of adjacency.get(cur) || []) {
        if (!parent.has(nb)) { parent.set(nb, cur); queue.push(nb); }
      }
    }
    return null;
  }

  // Compute visible nodes based on mode
  const { visibleNodes, visibleLinks, pathNodes, summary } = useMemo(() => {
    let pool: GraphNode[] = [];
    let pathIds: string[] | null = null;
    let summaryText = '';

    if (mode === 'questions') {
      // Just the root
      pool = rootNode ? [rootNode] : [];
      summaryText = rootNode ? `Select an investigation question to explore ${rootNode.label}'s network.` : '';
    } else if (mode === 'ownership') {
      // Root + PSCs + corporate PSC chains
      const ids = new Set<string>([rootId]);
      for (const l of links) {
        if (l.type !== 'psc') continue;
        const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
        if (s === rootId || t === rootId) { ids.add(s); ids.add(t); }
      }
      pool = nodes.filter((n) => ids.has(n.id));
      const pscCount = pool.filter((n) => n.id !== rootId).length;
      summaryText = `${rootNode?.label} has ${pscCount} person(s) with significant control.`;
    } else if (mode === 'directors') {
      // Root + directors + their other companies
      const directorIds = new Set<string>();
      const ids = new Set<string>([rootId]);
      for (const l of links) {
        if (l.type !== 'director' && l.type !== 'appointment') continue;
        const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
        if (s === rootId || t === rootId) {
          ids.add(s); ids.add(t);
          const personId = nodes.find((n) => n.id === s)?.entityType === 'person' ? s : t;
          directorIds.add(personId);
        }
      }
      // Add directors' other companies
      for (const l of links) {
        if (l.type !== 'director' && l.type !== 'appointment') continue;
        const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
        if (directorIds.has(s) || directorIds.has(t)) { ids.add(s); ids.add(t); }
      }
      pool = nodes.filter((n) => ids.has(n.id) && !n.isFormationAgent);
      const dirCount = pool.filter((n) => n.entityType === 'person').length;
      const otherCoCount = pool.filter((n) => n.entityType === 'company' && n.id !== rootId).length;
      summaryText = `${rootNode?.label} has ${dirCount} directors who collectively direct ${otherCoCount} other companies.`;
    } else if (mode === 'suspicious') {
      // Only entities in findings
      const flaggedIds = new Set<string>();
      for (const f of findings) {
        for (const eid of f.affectedEntities || []) {
          const node = nodes.find((n) => n.entityId === eid || n.id === eid);
          if (node) flaggedIds.add(node.id);
        }
      }
      flaggedIds.add(rootId);
      // Include edges between flagged
      pool = nodes.filter((n) => flaggedIds.has(n.id));
      summaryText = `${findings.length} risk signals detected. ${flaggedIds.size - 1} entities flagged in ${rootNode?.label}'s network.`;
    } else if (mode === 'path') {
      const fromNode = pathFrom ? (nodes.find((n) => n.label?.toLowerCase().includes(pathFrom.toLowerCase())) || null) : null;
      const toNode = pathTo ? (nodes.find((n) => n.label?.toLowerCase().includes(pathTo.toLowerCase())) || null) : null;
      if (fromNode && toNode && fromNode.id !== toNode.id) {
        pathIds = findPath(fromNode.id, toNode.id);
        if (pathIds) {
          pool = nodes.filter((n) => pathIds!.includes(n.id));
          // Build plain English path
          const pathLabels = pathIds.map((id) => {
            const n = nodes.find((x) => x.id === id);
            return n ? n.label : id;
          });
          const segments: string[] = [];
          for (let i = 0; i < pathIds.length - 1; i++) {
            const edge = links.find((l) => {
              const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
              const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
              return (s === pathIds![i] && t === pathIds![i + 1]) || (t === pathIds![i] && s === pathIds![i + 1]);
            });
            const rel = edge?.type === 'director' ? 'directed by' : edge?.type === 'psc' ? 'owned by' : edge?.type === 'address' ? 'registered at' : 'connected to';
            segments.push(`${pathLabels[i]} → (${rel}) → ${pathLabels[i + 1]}`);
          }
          summaryText = `Path: ${segments.join(' → ')}`;
        } else {
          pool = [];
          summaryText = `No connection found between ${fromNode.label} and ${toNode.label}.`;
        }
      } else {
        pool = rootNode ? [rootNode] : [];
        summaryText = 'Select two entities to find the path between them.';
      }
    } else if (mode === 'spotlight' && spotlightId) {
      const ids = new Set<string>([spotlightId]);
      for (const nb of adjacency.get(spotlightId) || []) ids.add(nb);
      pool = nodes.filter((n) => ids.has(n.id));
      const center = nodes.find((n) => n.id === spotlightId);
      summaryText = center ? `${center.label} (${center.entityType}) has ${(adjacency.get(spotlightId)?.size || 0)} direct connections.` : '';
    } else {
      // Full network
      pool = nodes.filter((n) => !n.isFormationAgent).sort((a, b) => (b.degree || 0) - (a.degree || 0)).slice(0, 400);
      if (!pool.find((n) => n.id === rootId) && rootNode) pool.push(rootNode);
      summaryText = `Full network: ${pool.length} entities shown (of ${nodes.length} total).`;
    }

    const visSet = new Set(pool.map((n) => n.id));
    const vLinks = links.filter((l) => {
      const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
      return visSet.has(s) && visSet.has(t);
    });

    return { visibleNodes: pool, visibleLinks: vLinks, pathNodes: pathIds, summary: summaryText };
  }, [nodes, links, findings, mode, rootId, rootNode, adjacency, pathFrom, pathTo, spotlightId]);

  // Handle node click — spotlight mode
  const handleNodeClick = (n: GraphNode | null) => {
    if (!n) { onNodeClick?.(null); return; }
    onNodeClick?.(n);
    if (mode !== 'path') {
      setSpotlightId(n.id);
      setBreadcrumb((prev) => [...prev.filter((id) => id !== n.id), n.id]);
      setMode('spotlight');
    }
  };

  // D3 render
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const width = containerRef.current?.clientWidth || 800;
    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const radial = defs.append('radialGradient').attr('id', 'bg-r').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    radial.append('stop').attr('offset', '0%').attr('stop-color', '#171717');
    radial.append('stop').attr('offset', '100%').attr('stop-color', '#0A0A0A');
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'url(#bg-r)');

    const root = svg.append('g');
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 5]).on('zoom', (e) => root.attr('transform', e.transform.toString()));
    svg.call(zoom as any);

    if (visibleNodes.length === 0) {
      if (mode === 'questions' && rootNode) {
        // Show just the root node centered
        root.append('circle').attr('cx', width / 2).attr('cy', height / 2).attr('r', 24).attr('fill', ROOT_COLOR);
        root.append('text').attr('x', width / 2).attr('y', height / 2 + 40).attr('text-anchor', 'middle')
          .attr('fill', '#A0A0A0').attr('font-size', 11).attr('font-family', 'ui-monospace, monospace')
          .text(rootNode.label);
      }
      return;
    }

    const cx = width / 2;
    const cy = height / 2;
    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    const idMap = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: GraphLink[] = visibleLinks
      .map((l) => ({ ...l, source: idMap.get(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id) || l.source, target: idMap.get(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id) || l.target }))
      .filter((l) => typeof l.source !== 'string' && typeof l.target !== 'string');

    // Pin root/spotlight center
    const centerId = mode === 'spotlight' ? spotlightId : rootId;
    const centerSim = simNodes.find((n) => n.id === centerId);
    if (centerSim) { centerSim.fx = cx; centerSim.fy = cy; }

    // Structured layout for small graphs
    if (simNodes.length <= 30) {
      const others = simNodes.filter((n) => n.id !== centerId);
      const persons = others.filter((n) => n.entityType === 'person');
      const companies = others.filter((n) => n.entityType === 'company');
      const addresses = others.filter((n) => n.entityType === 'address');
      const r1 = Math.min(width, height) * 0.2;
      const r2 = Math.min(width, height) * 0.36;
      persons.forEach((d, i) => { const a = (i / Math.max(persons.length, 1)) * Math.PI * 2 - Math.PI / 2; d.x = cx + Math.cos(a) * r1; d.y = cy + Math.sin(a) * r1; });
      companies.forEach((c, i) => { const a = (i / Math.max(companies.length, 1)) * Math.PI * 2 - Math.PI / 2; c.x = cx + Math.cos(a) * r2; c.y = cy + Math.sin(a) * r2; });
      addresses.forEach((a, i) => { a.x = cx - (addresses.length * 25) / 2 + i * 50; a.y = cy + Math.min(width, height) * 0.38; });
    }

    const isPath = mode === 'path' && pathNodes;
    const sim = d3.forceSimulation<GraphNode>(simNodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id((d) => d.id).distance(simNodes.length <= 15 ? 120 : 80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(cx, cy).strength(0.03))
      .force('collide', d3.forceCollide<GraphNode>().radius(20));
    if (simNodes.length <= 30) sim.alpha(0.4);

    // Edges
    const linkSel = root.append('g').selectAll('line').data(simLinks).enter().append('line')
      .attr('stroke', (d) => {
        if (isPath) return 'rgba(94,230,161,0.6)';
        if (mode === 'suspicious') return 'rgba(255,77,77,0.3)';
        return d.type === 'address' ? 'rgba(115,115,115,0.18)' : d.type === 'psc' ? 'rgba(245,197,24,0.35)' : 'rgba(94,230,161,0.22)';
      })
      .attr('stroke-width', isPath ? 2.5 : 1)
      .attr('stroke-dasharray', (d) => d.type === 'address' ? '3,3' : d.type === 'psc' ? '4,3' : (null as any))
      .attr('opacity', 0.75);

    // Edge labels for small graphs
    if (simNodes.length <= 20) {
      const edgeLabels = root.append('g').selectAll('text').data(simLinks).enter().append('text')
        .text((d) => d.type === 'director' ? 'director' : d.type === 'psc' ? 'owner' : d.type === 'address' ? 'address' : d.type)
        .attr('font-size', 8).attr('fill', 'rgba(255,255,255,0.2)').attr('text-anchor', 'middle').attr('font-family', 'ui-monospace, monospace');
      sim.on('tick.labels', () => {
        edgeLabels.attr('x', (d) => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
          .attr('y', (d) => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2 - 4);
      });
    }

    // Nodes
    const nodeGroup = root.append('g').selectAll('g').data(simNodes).enter().append('g').style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => { if (!event.active) sim.alphaTarget(0); if (d.id !== centerId) { d.fx = null; d.fy = null; } }) as any)
      .on('mouseenter', (event, d) => {
        const rect = containerRef.current!.getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d });
        const nbs = adjacency.get(d.id) || new Set();
        nodeGroup.transition().duration(120).attr('opacity', (n) => n.id === d.id || nbs.has(n.id) ? 1 : 0.1);
        linkSel.transition().duration(120).attr('opacity', (l) => { const s = (l.source as GraphNode).id; const t = (l.target as GraphNode).id; return s === d.id || t === d.id ? 1 : 0.04; })
          .attr('stroke-width', (l) => { const s = (l.source as GraphNode).id; const t = (l.target as GraphNode).id; return s === d.id || t === d.id ? 3 : 1; });
      })
      .on('mouseleave', () => {
        setTooltip(null);
        nodeGroup.transition().duration(120).attr('opacity', 1);
        linkSel.transition().duration(120).attr('opacity', 0.75).attr('stroke-width', isPath ? 2.5 : 1);
      })
      .on('click', (e, d) => { e.stopPropagation(); handleNodeClick(d); });

    // Risk halos
    if (showRisk || mode === 'suspicious') {
      nodeGroup.filter((d) => isRisky(d)).append('circle')
        .attr('r', (d) => (d.id === centerId ? 22 : 12)).attr('fill', 'none').attr('stroke', RISK_RED).attr('stroke-width', 1.5).attr('opacity', 0.6);
    }

    // Main circles
    const isCenter = (d: GraphNode) => d.id === centerId;
    nodeGroup.append('circle')
      .attr('r', (d) => isCenter(d) ? 18 : mode === 'suspicious' && isRisky(d) ? 10 : Math.max(5, Math.min(12, 4 + Math.sqrt(d.degree || 1) * 1.5)))
      .attr('fill', (d) => isCenter(d) ? ROOT_COLOR : mode === 'suspicious' && isRisky(d) ? RISK_RED : TYPE_COLOR[d.entityType] || '#94A3B8')
      .attr('stroke', (d) => isCenter(d) ? '#FFF' : 'rgba(0,0,0,0.3)').attr('stroke-width', (d) => isCenter(d) ? 2 : 0.5);

    // Labels - always show for small views
    const showLabel = simNodes.length <= 40;
    nodeGroup.filter((d) => showLabel || isCenter(d) || (d.degree || 0) >= 5).append('text')
      .text((d) => d.label.length > 25 ? d.label.slice(0, 23) + '..' : d.label)
      .attr('font-size', (d) => isCenter(d) ? 12 : 9).attr('font-weight', (d) => isCenter(d) ? 600 : 400)
      .attr('text-anchor', 'middle').attr('dy', (d) => (isCenter(d) ? 18 : 10) + 12)
      .attr('fill', (d) => isCenter(d) ? '#FFF' : '#A0A0A0').attr('font-family', 'ui-monospace, monospace').attr('pointer-events', 'none');

    sim.on('tick', () => {
      linkSel.attr('x1', (d) => (d.source as GraphNode).x!).attr('y1', (d) => (d.source as GraphNode).y!).attr('x2', (d) => (d.target as GraphNode).x!).attr('y2', (d) => (d.target as GraphNode).y!);
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    svg.on('click', () => onNodeClick?.(null));
    return () => { sim.stop(); };
  }, [visibleNodes, visibleLinks, height, mode, rootId, spotlightId, showRisk, pathNodes]);

  const questions = [
    { id: 'ownership', icon: '🔗', title: 'Who controls this company?', desc: 'Ownership and PSC structure' },
    { id: 'directors', icon: '👤', title: 'Who runs this company?', desc: 'Directors and their other companies' },
    { id: 'suspicious', icon: '⚠', title: "What's suspicious?", desc: 'Entities with risk findings only' },
    { id: 'path', icon: '🔍', title: 'How are they connected?', desc: 'Find the path between two entities' },
    { id: 'full', icon: '◉', title: 'Show full network', desc: `All ${nodes.length.toLocaleString()} entities` },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-4" style={{ height }}>
      {/* Left sidebar - questions */}
      <div className="lg:w-64 shrink-0 space-y-2 overflow-y-auto">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">/ Investigate</div>
        {questions.map((q) => (
          <button key={q.id} onClick={() => { setMode(q.id as ViewMode); setSpotlightId(null); setBreadcrumb([]); }}
            className={`w-full text-left px-3 py-3 rounded-sm border transition-colors ${mode === q.id ? 'bg-ink-900 border-white/20' : 'bg-ink-900/40 border-white/5 hover:border-white/15'}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{q.icon}</span>
              <span className={`text-xs ${mode === q.id ? 'text-ink-50' : 'text-ink-300'}`}>{q.title}</span>
            </div>
            <div className="text-[10px] text-ink-500">{q.desc}</div>
          </button>
        ))}

        {/* Path inputs */}
        {mode === 'path' && (
          <div className="border border-white/5 bg-ink-900 p-3 space-y-2 mt-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">Find a path</div>
            <input type="text" placeholder="From entity..." value={pathFrom} onChange={(e) => setPathFrom(e.target.value)}
              className="w-full bg-ink-850 border border-white/10 rounded-sm text-xs text-ink-50 placeholder:text-ink-600 px-2 py-1.5 focus:outline-none focus:border-white/30" />
            <input type="text" placeholder="To entity..." value={pathTo} onChange={(e) => setPathTo(e.target.value)}
              className="w-full bg-ink-850 border border-white/10 rounded-sm text-xs text-ink-50 placeholder:text-ink-600 px-2 py-1.5 focus:outline-none focus:border-white/30" />
            {pathFrom && pathTo && <button onClick={() => { setPathFrom(''); setPathTo(''); }} className="text-[9px] font-mono text-ink-500 hover:text-ink-50">clear</button>}
          </div>
        )}

        {/* Breadcrumb trail for spotlight */}
        {breadcrumb.length > 1 && mode === 'spotlight' && (
          <div className="border border-white/5 bg-ink-900 p-3 mt-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500 mb-2">Path walked</div>
            <div className="space-y-1">
              {breadcrumb.map((id, i) => {
                const n = nodes.find((x) => x.id === id);
                return (
                  <button key={i} onClick={() => { setSpotlightId(id); setBreadcrumb(breadcrumb.slice(0, i + 1)); }}
                    className="block text-[10px] text-ink-300 hover:text-ink-50 truncate w-full text-left">
                    {i > 0 && <span className="text-ink-600 mr-1">→</span>}{n?.label || id}
                  </button>
                );
              })}
            </div>
            <button onClick={() => { setMode('questions'); setBreadcrumb([]); setSpotlightId(null); }}
              className="text-[9px] font-mono text-ink-500 hover:text-ink-50 mt-2">← back to questions</button>
          </div>
        )}

        {/* Controls */}
        <div className="border-t border-white/5 pt-3 mt-3 space-y-2">
          <input type="text" placeholder="search..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-ink-850 border border-white/10 rounded-sm text-xs text-ink-50 placeholder:text-ink-600 px-2 py-1.5 focus:outline-none" />
          <div className="flex gap-2">
            <button onClick={() => setShowRisk(!showRisk)}
              className={`text-[9px] font-mono px-2 py-1 rounded-sm border ${showRisk ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' : 'text-ink-500 border-white/10'}`}>risk overlay</button>
            <button onClick={() => setLegendOpen(!legendOpen)}
              className="text-[9px] font-mono text-ink-500 px-2 py-1 rounded-sm border border-white/10">legend</button>
          </div>
        </div>
      </div>

      {/* Graph + summary */}
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={containerRef} className="flex-1 relative bg-ink-900 border border-white/5 overflow-hidden">
          <svg ref={svgRef} className="w-full h-full" />

          {/* Tooltip */}
          {tooltip && (
            <div className="absolute pointer-events-none bg-ink-900 border border-white/10 text-ink-50 text-xs rounded-sm px-3 py-2 shadow-2xl max-w-xs z-20"
              style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>
              <div className="font-medium">{tooltip.node.label}</div>
              <div className="text-ink-500 text-[10px] font-mono mt-0.5">{tooltip.node.entityType} - {tooltip.node.degree} connections</div>
              {tooltip.node.hasMatch && <div className="mt-1 text-signal-critical font-mono text-[10px]">SANCTIONS MATCH</div>}
            </div>
          )}

          {/* Legend */}
          {legendOpen && (
            <div className="absolute bottom-3 left-3 z-10 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm p-3 text-[9px] font-mono text-ink-500 space-y-1.5">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-white shrink-0" /> Target</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#F5C518' }} /> Company</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#5EE6A1' }} /> Person</div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: '#737373' }} /> Address</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-signal-critical shrink-0" /> Risk</div>
            </div>
          )}

          {/* Node count */}
          <div className="absolute bottom-3 right-3 z-10 text-[9px] font-mono text-ink-600">
            {visibleNodes.length} nodes - {visibleLinks.length} edges
          </div>

          {mode === 'questions' && visibleNodes.length <= 1 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                {rootNode && (
                  <>
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                      <span className="text-lg font-bold text-ink-50">{rootNode.label[0]}</span>
                    </div>
                    <div className="text-sm text-ink-50 mb-1">{rootNode.label}</div>
                    <div className="text-[10px] text-ink-500 font-mono">Select a question to explore</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Summary */}
        {summary && (
          <div className="border border-white/5 bg-ink-850 px-4 py-3 mt-2 text-xs text-ink-300">
            {summary}
          </div>
        )}
      </div>
    </div>
  );
}
