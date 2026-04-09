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

const TYPE_COLOR: Record<string, { fill: string; ring: string; label: string }> = {
  company: { fill: '#F5C518', ring: 'rgba(245,197,24,0.25)', label: 'Companies' },
  person:  { fill: '#5EE6A1', ring: 'rgba(94,230,161,0.25)', label: 'People' },
  address: { fill: '#737373', ring: 'rgba(115,115,115,0.25)', label: 'Addresses' },
};

const ROOT_COLOR = '#FFFFFF';
const RISK_RED = '#FF4D4D';
const RISK_AMBER = '#FF8A3D';

const SEV_COLOR: Record<string, string> = {
  CRITICAL: '#FF4D4D',
  HIGH: '#FF8A3D',
  MEDIUM: '#F5C518',
  LOW: '#737373',
};

function isRisky(n: GraphNode): 'critical' | 'warning' | null {
  if (n.shellRisk === 'CRITICAL' || n.proximityScore === 'CRITICAL' || n.hasMatch) return 'critical';
  if (n.shellRisk === 'HIGH' || n.proximityScore === 'HIGH') return 'critical';
  if (n.shellRisk === 'MEDIUM' || n.proximityScore === 'MEDIUM' || n.addressFlag === 'HIGH_DENSITY') return 'warning';
  return null;
}

function nodeRadius(n: GraphNode, isRoot: boolean): number {
  if (isRoot) return 14;
  return Math.max(5, Math.min(22, 4 + Math.sqrt(n.degree || 1) * 2.4));
}

interface Pattern {
  id: string;
  title: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  count: number;
  nodeIds: Set<string>;
}

const SEV_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

export function GraphVisualization({ nodes, links, findings = [], height = 720, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);

  // ----- Toolbar state -----
  const [search, setSearch] = useState('');
  const [showCompanies, setShowCompanies] = useState(true);
  const [showPeople, setShowPeople] = useState(true);
  const [showAddresses, setShowAddresses] = useState(true);
  const [riskOnly, setRiskOnly] = useState(false);
  const [toolbarOpen, setToolbarOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'ownership' | 'directors' | 'addresses' | 'risk'>('all');
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');

  // ----- Adjacency + root + label index -----
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

  const rootId = useMemo(() => {
    if (nodes.length === 0) return '';
    return [...nodes].sort((a, b) => (b.degree || 0) - (a.degree || 0))[0].id;
  }, [nodes]);

  const labelToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) {
      if (n.label) m.set(n.label.toLowerCase().trim(), n.id);
    }
    return m;
  }, [nodes]);

  // ----- Patterns derived from findings -----
  const patterns = useMemo<Pattern[]>(() => {
    if (!findings.length) return [];
    return findings
      .map((f, i) => {
        const ids = new Set<string>();
        for (const ent of f.affectedEntities || []) {
          const id = labelToId.get(ent.toLowerCase().trim());
          if (id) ids.add(id);
        }
        return {
          id: `${f.type}-${i}`,
          title: f.title,
          type: f.type,
          severity: f.severity,
          count: ids.size,
          nodeIds: ids,
        };
      })
      .filter((p) => p.count > 0)
      .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0) || b.count - a.count)
      .slice(0, 6);
  }, [findings, labelToId]);

  // Default to top pattern if available
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  useEffect(() => {
    if (patterns.length > 0 && selectedPatternId === null && !showAll) {
      setSelectedPatternId(patterns[0].id);
    }
  }, [patterns, selectedPatternId, showAll]);

  const activePattern = patterns.find((p) => p.id === selectedPatternId) || null;

  // ----- Auto-label set -----
  // ROOT, HUB (top-degree person), BRIDGE (from BRIDGE_PERSON findings), SHELL, MATCHED, OFFSHORE
  const autoLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (rootId) labels.set(rootId, 'ROOT');

    const topPerson = [...nodes]
      .filter((n) => n.entityType === 'person')
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))[0];
    if (topPerson && topPerson.id !== rootId && (topPerson.degree || 0) >= 3) {
      labels.set(topPerson.id, 'HUB');
    }

    for (const f of findings) {
      const tag =
        /BRIDGE/i.test(f.type) ? 'BRIDGE' :
        /SHELL/i.test(f.type) ? 'SHELL' :
        /OFFSHORE/i.test(f.type) ? 'OFFSHORE' :
        null;
      if (!tag) continue;
      for (const ent of f.affectedEntities || []) {
        const id = labelToId.get(ent.toLowerCase().trim());
        if (id && !labels.has(id)) labels.set(id, tag);
      }
    }

    for (const n of nodes) {
      if (n.hasMatch && !labels.has(n.id)) labels.set(n.id, 'MATCHED');
    }
    return labels;
  }, [nodes, findings, labelToId, rootId]);

  // ----- Filtered visible set -----
  const { visibleNodes, visibleLinks, totalAfterFilters, pathInfo } = useMemo(() => {
    if (nodes.length === 0) return { visibleNodes: [], visibleLinks: [], totalAfterFilters: 0, pathInfo: null as any };

    // ─── PATH MODE — highest priority ───
    const findByQuery = (q: string) => {
      const ql = q.toLowerCase().trim();
      if (!ql) return null;
      return nodes.find((n) => n.label?.toLowerCase() === ql)
        || nodes.find((n) => n.label?.toLowerCase().includes(ql))
        || null;
    };
    const fromNode = findByQuery(pathFrom);
    const toNode = findByQuery(pathTo);
    if (fromNode && toNode && fromNode.id !== toNode.id) {
      const parent = new Map<string, string | null>();
      parent.set(fromNode.id, null);
      const queue = [fromNode.id];
      let found = false;
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur === toNode.id) { found = true; break; }
        for (const nb of adjacency.get(cur) || []) {
          if (!parent.has(nb)) {
            parent.set(nb, cur);
            queue.push(nb);
          }
        }
      }
      if (found) {
        const pathIds = new Set<string>();
        let cur: string | null = toNode.id;
        while (cur) { pathIds.add(cur); cur = parent.get(cur) || null; }
        const pNodes = nodes.filter((n) => pathIds.has(n.id));
        const pLinks = links.filter((l) => {
          const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
          const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
          return pathIds.has(s) && pathIds.has(t);
        });
        return {
          visibleNodes: pNodes,
          visibleLinks: pLinks,
          totalAfterFilters: pNodes.length,
          pathInfo: { from: fromNode.label, to: toNode.label, hops: pNodes.length - 1, found: true },
        };
      }
      return {
        visibleNodes: [],
        visibleLinks: [],
        totalAfterFilters: 0,
        pathInfo: { from: fromNode.label, to: toNode.label, hops: 0, found: false },
      };
    }

    // ─── Standard pipeline ───
    let pool = nodes.filter((n) => {
      if (n.entityType === 'company' && !showCompanies) return false;
      if (n.entityType === 'person' && !showPeople) return false;
      if (n.entityType === 'address' && !showAddresses) return false;
      if (riskOnly && !isRisky(n)) return false;
      return true;
    });

    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter((n) => n.label?.toLowerCase().includes(q) || n.id === rootId);
    }

    // Risk view mode: only risky nodes + 1-hop neighbors + root
    if (viewMode === 'risk') {
      const keep = new Set<string>();
      if (rootId) keep.add(rootId);
      for (const n of nodes) {
        if (isRisky(n)) {
          keep.add(n.id);
          for (const nb of adjacency.get(n.id) || []) keep.add(nb);
        }
      }
      pool = pool.filter((n) => keep.has(n.id));
    }

    const totalAfter = pool.length;

    let visibleSet: Set<string>;
    if (activePattern && !showAll) {
      visibleSet = new Set(activePattern.nodeIds);
      if (rootId) visibleSet.add(rootId);
      for (const id of activePattern.nodeIds) {
        const nb = adjacency.get(id);
        if (nb) for (const x of nb) visibleSet.add(x);
      }
      pool = pool.filter((n) => visibleSet.has(n.id));
    } else {
      const sorted = [...pool].sort((a, b) => (b.degree || 0) - (a.degree || 0));
      pool = sorted.slice(0, 400);
      visibleSet = new Set(pool.map((n) => n.id));
      if (rootId && !visibleSet.has(rootId)) {
        const r = nodes.find((n) => n.id === rootId);
        if (r) {
          pool.push(r);
          visibleSet.add(rootId);
        }
      }
    }

    // Edge filter by view mode
    const edgeAllowed = (type: string) => {
      if (viewMode === 'ownership') return type === 'psc';
      if (viewMode === 'directors') return type !== 'psc' && type !== 'address';
      if (viewMode === 'addresses') return type === 'address';
      return true;
    };

    let vLinks = links.filter((l) => {
      if (!edgeAllowed(l.type)) return false;
      const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
      return visibleSet.has(s) && visibleSet.has(t);
    });

    // Drop orphans (no edges) except root, when an edge filter is in effect
    if (viewMode === 'ownership' || viewMode === 'directors' || viewMode === 'addresses') {
      const connected = new Set<string>();
      for (const l of vLinks) {
        const s = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const t = typeof l.target === 'string' ? l.target : (l.target as any).id;
        connected.add(s); connected.add(t);
      }
      pool = pool.filter((n) => connected.has(n.id) || n.id === rootId);
    }

    return { visibleNodes: pool, visibleLinks: vLinks, totalAfterFilters: totalAfter, pathInfo: null };
  }, [nodes, links, showCompanies, showPeople, showAddresses, riskOnly, search, rootId, activePattern, showAll, adjacency, viewMode, pathFrom, pathTo]);

  // ----- D3 render -----
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const width = containerRef.current?.clientWidth || 800;

    const svg = d3.select(svgEl).attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'b');
    const merge = filter.append('feMerge');
    merge.append('feMergeNode').attr('in', 'b');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    const radial = defs.append('radialGradient').attr('id', 'bg-radial').attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
    radial.append('stop').attr('offset', '0%').attr('stop-color', '#171717');
    radial.append('stop').attr('offset', '100%').attr('stop-color', '#0A0A0A');
    svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'url(#bg-radial)');

    const root = svg.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => root.attr('transform', e.transform.toString()));
    svg.call(zoom as any);

    if (visibleNodes.length === 0) return;

    const simNodes: GraphNode[] = visibleNodes.map((n) => ({ ...n }));
    const idMap = new Map(simNodes.map((n) => [n.id, n] as const));
    const simLinks: GraphLink[] = visibleLinks
      .map((l) => ({
        ...l,
        source: idMap.get(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id) || l.source,
        target: idMap.get(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id) || l.target,
      }))
      .filter((l) => typeof l.source !== 'string' && typeof l.target !== 'string');

    const rootSim = simNodes.find((n) => n.id === rootId);
    if (rootSim) {
      rootSim.fx = width / 2;
      rootSim.fy = height / 2;
    }

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
      .force('charge', d3.forceManyBody().strength((d: any) => -250 - (d.degree || 1) * 6))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => nodeRadius(d, d.id === rootId) + 6));

    const searchTokens = search.toLowerCase().trim();
    const matchSet = new Set<string>();
    if (searchTokens) {
      for (const n of simNodes) {
        if (n.label?.toLowerCase().includes(searchTokens)) matchSet.add(n.id);
      }
    }

    // Pattern highlight set — these get a brighter render when a pattern is active
    const patternSet = activePattern ? activePattern.nodeIds : null;
    const isInPattern = (id: string) => !patternSet || patternSet.has(id) || id === rootId;

    const linkSel = root
      .append('g')
      .attr('stroke-linecap', 'round')
      .selectAll('line')
      .data(simLinks)
      .enter()
      .append('line')
      .attr('stroke', (d) => {
        if (d.type === 'address') return 'rgba(115,115,115,0.18)';
        if (d.type === 'psc') return 'rgba(245,197,24,0.35)';
        return 'rgba(94,230,161,0.22)';
      })
      .attr('stroke-width', (d) => (d.type === 'psc' ? 1.6 : 1))
      .attr('stroke-dasharray', (d) => (d.type === 'address' ? '3,3' : (null as any)))
      .attr('opacity', (d) => {
        if (!patternSet) return 0.75;
        const s = (d.source as GraphNode).id;
        const t = (d.target as GraphNode).id;
        return isInPattern(s) && isInPattern(t) ? 0.9 : 0.1;
      });

    const nodeGroup = root
      .append('g')
      .selectAll('g')
      .data(simNodes)
      .enter()
      .append('g')
      .style('cursor', 'pointer')
      .attr('opacity', (d) => (isInPattern(d.id) ? 1 : 0.18))
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            if (d.id !== rootId) {
              d.fx = null;
              d.fy = null;
            }
          }) as any,
      )
      .on('mouseenter', (event, d) => {
        const rect = (containerRef.current as HTMLDivElement).getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, node: d });
        const neighbors = adjacency.get(d.id) || new Set();
        nodeGroup.transition().duration(120).attr('opacity', (n) =>
          n.id === d.id || neighbors.has(n.id) ? 1 : 0.12,
        );
        linkSel.transition().duration(120).attr('opacity', (l) => {
          const s = (l.source as GraphNode).id;
          const t = (l.target as GraphNode).id;
          return s === d.id || t === d.id ? 1 : 0.04;
        });
      })
      .on('mouseleave', () => {
        setTooltip(null);
        nodeGroup.transition().duration(120).attr('opacity', (n) => (isInPattern(n.id) ? 1 : 0.18));
        linkSel.transition().duration(120).attr('opacity', (d) => {
          if (!patternSet) return 0.75;
          const s = (d.source as GraphNode).id;
          const t = (d.target as GraphNode).id;
          return isInPattern(s) && isInPattern(t) ? 0.9 : 0.1;
        });
      })
      .on('click', (e, d) => {
        e.stopPropagation();
        onNodeClick?.(d);
      });

    nodeGroup
      .filter((d) => isRisky(d) !== null)
      .append('circle')
      .attr('r', (d) => nodeRadius(d, d.id === rootId) + 5)
      .attr('fill', 'none')
      .attr('stroke', (d) => (isRisky(d) === 'critical' ? RISK_RED : RISK_AMBER))
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.6)
      .attr('filter', 'url(#glow)');

    nodeGroup
      .filter((d) => d.id !== rootId)
      .append('circle')
      .attr('r', (d) => nodeRadius(d, false) + 2)
      .attr('fill', (d) => TYPE_COLOR[d.entityType]?.ring || 'rgba(255,255,255,0.1)')
      .attr('stroke', 'none');

    nodeGroup
      .append('circle')
      .attr('r', (d) => nodeRadius(d, d.id === rootId))
      .attr('fill', (d) => (d.id === rootId ? ROOT_COLOR : TYPE_COLOR[d.entityType]?.fill || '#94A3B8'))
      .attr('stroke', (d) => {
        const r = isRisky(d);
        if (r === 'critical') return RISK_RED;
        if (r === 'warning') return RISK_AMBER;
        if (d.id === rootId) return '#FFFFFF';
        return 'rgba(0,0,0,0.4)';
      })
      .attr('stroke-width', (d) => {
        if (isRisky(d)) return 2;
        if (d.id === rootId) return 2;
        return 0.5;
      });

    if (matchSet.size > 0) {
      nodeGroup
        .filter((d) => matchSet.has(d.id))
        .append('circle')
        .attr('r', (d) => nodeRadius(d, d.id === rootId) + 8)
        .attr('fill', 'none')
        .attr('stroke', '#FFFFFF')
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8)
        .attr('stroke-dasharray', '3,2');
    }

    // Auto-label badges (small mono text above the node)
    nodeGroup
      .filter((d) => autoLabels.has(d.id))
      .append('text')
      .text((d) => autoLabels.get(d.id) || '')
      .attr('font-size', 8)
      .attr('font-weight', 600)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => -nodeRadius(d, d.id === rootId) - 8)
      .attr('fill', (d) => {
        const tag = autoLabels.get(d.id);
        if (tag === 'MATCHED' || tag === 'OFFSHORE') return '#FF4D4D';
        if (tag === 'SHELL' || tag === 'BRIDGE') return '#FF8A3D';
        if (tag === 'HUB') return '#5EE6A1';
        return '#FFFFFF';
      })
      .attr('font-family', 'ui-monospace, monospace')
      .attr('letter-spacing', '0.05em')
      .attr('pointer-events', 'none');

    // Name labels — root + larger nodes only
    nodeGroup
      .filter((d) => d.id === rootId || nodeRadius(d, false) >= 9 || matchSet.has(d.id))
      .append('text')
      .text((d) => (d.label.length > 24 ? d.label.slice(0, 22) + '…' : d.label))
      .attr('font-size', (d) => (d.id === rootId ? 12 : 10))
      .attr('font-weight', (d) => (d.id === rootId ? 600 : 400))
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => nodeRadius(d, d.id === rootId) + 16)
      .attr('fill', (d) => (d.id === rootId ? '#FFFFFF' : '#A0A0A0'))
      .attr('font-family', 'ui-monospace, monospace')
      .attr('pointer-events', 'none');

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    svg.on('click', () => onNodeClick?.(null));

    return () => {
      sim.stop();
    };
  }, [visibleNodes, visibleLinks, height, onNodeClick, adjacency, rootId, search, activePattern, autoLabels]);

  const typeCounts = useMemo(() => {
    const c = { company: 0, person: 0, address: 0 };
    for (const n of nodes) c[n.entityType]++;
    return c;
  }, [nodes]);

  const totalNodes = nodes.length;
  const shownNodes = visibleNodes.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Patterns Panel */}
      <aside className="lg:col-span-1 border border-white/5 bg-ink-850 p-5 space-y-5 h-fit">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">/ Patterns detected</div>
          <div className="text-[10px] font-mono text-ink-600">click to isolate the network slice</div>
        </div>

        {patterns.length === 0 ? (
          <div className="text-xs font-mono text-ink-500 py-4 border border-dashed border-white/5 px-3">
            no structural patterns detected — try "show all" below
          </div>
        ) : (
          <div className="space-y-1.5">
            {patterns.map((p) => {
              const active = p.id === selectedPatternId && !showAll;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedPatternId(p.id);
                    setShowAll(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-sm border transition-colors ${
                    active
                      ? 'bg-ink-900 border-white/30'
                      : 'bg-ink-900/40 border-white/5 hover:border-white/15'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: SEV_COLOR[p.severity] }}
                    />
                    <span className="text-[9px] font-mono uppercase tracking-wider text-ink-500">
                      {p.severity}
                    </span>
                    <span className="text-[9px] font-mono text-ink-600 ml-auto tabular-nums">
                      {p.count} nodes
                    </span>
                  </div>
                  <div className={`text-xs leading-snug ${active ? 'text-ink-50' : 'text-ink-300'}`}>
                    {p.title}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={() => {
            setShowAll(true);
            setSelectedPatternId(null);
          }}
          className={`w-full text-xs font-mono px-3 py-2 rounded-sm border transition-colors ${
            showAll
              ? 'bg-ink-900 border-white/30 text-ink-50'
              : 'bg-ink-900/40 border-white/5 text-ink-400 hover:border-white/15'
          }`}
        >
          ⊞ show whole network
        </button>

        <div className="border-t border-white/5 pt-4 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">/ Auto-labels</div>
          <div className="space-y-1 text-[10px] font-mono">
            <div className="flex justify-between"><span className="text-white">ROOT</span><span className="text-ink-600">subject</span></div>
            <div className="flex justify-between"><span className="text-signal-clean">HUB</span><span className="text-ink-600">top connector</span></div>
            <div className="flex justify-between"><span className="text-signal-medium">BRIDGE</span><span className="text-ink-600">spans clusters</span></div>
            <div className="flex justify-between"><span className="text-signal-medium">SHELL</span><span className="text-ink-600">shell company</span></div>
            <div className="flex justify-between"><span className="text-signal-critical">MATCHED</span><span className="text-ink-600">sanctions hit</span></div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-2">/ Visible</div>
          <div className="text-2xl font-medium text-ink-50 tabular-nums">{shownNodes}</div>
          <div className="text-[10px] font-mono text-ink-500 mt-1">
            of {totalNodes.toLocaleString()} total
          </div>
        </div>
      </aside>

      {/* Graph canvas */}
      <div ref={containerRef} className="lg:col-span-3 relative w-full bg-ink-900 border border-white/5 overflow-hidden" style={{ height }}>
        <svg ref={svgRef} className="w-full h-full" />

        {/* View mode tabs (top-left) */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-px bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm shadow-lg overflow-hidden">
          {([
            ['all', 'Network'],
            ['ownership', 'Ownership'],
            ['directors', 'Directors'],
            ['addresses', 'Addresses'],
            ['risk', 'Risk paths'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 transition-colors ${
                viewMode === mode ? 'bg-white/10 text-ink-50' : 'text-ink-500 hover:text-ink-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Path info badge */}
        {pathInfo && (
          <div className="absolute top-14 left-3 z-10 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm px-3 py-1.5 shadow-lg text-[10px] font-mono">
            {pathInfo.found ? (
              <span className="text-ink-300">
                <span className="text-ink-500">path:</span> {pathInfo.from} <span className="text-ink-600">→</span> {pathInfo.to}{' '}
                <span className="text-signal-clean ml-1">{pathInfo.hops} hop{pathInfo.hops === 1 ? '' : 's'}</span>
              </span>
            ) : (
              <span className="text-signal-critical">no path between {pathInfo.from} and {pathInfo.to}</span>
            )}
          </div>
        )}

        {/* Floating toolbar (top-right) */}
        <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm px-2 py-1.5 shadow-lg">
            <input
              type="text"
              placeholder="search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-36 bg-transparent text-xs text-ink-50 placeholder:text-ink-600 focus:outline-none px-1"
            />
            <button
              onClick={() => setToolbarOpen(!toolbarOpen)}
              className="text-[10px] font-mono text-ink-500 hover:text-ink-50 px-1.5 py-0.5 border border-white/10 rounded-sm"
            >
              {toolbarOpen ? '×' : '⚙'}
            </button>
          </div>

          {toolbarOpen && (
            <div className="bg-ink-900/95 backdrop-blur border border-white/10 rounded-sm p-3 shadow-lg space-y-2 w-56">
              <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">show types</div>
              <div className="space-y-1">
                <ToggleRow label="Companies" count={typeCounts.company} color={TYPE_COLOR.company.fill} checked={showCompanies} onChange={setShowCompanies} />
                <ToggleRow label="People" count={typeCounts.person} color={TYPE_COLOR.person.fill} checked={showPeople} onChange={setShowPeople} />
                <ToggleRow label="Addresses" count={typeCounts.address} color={TYPE_COLOR.address.fill} checked={showAddresses} onChange={setShowAddresses} />
              </div>
              <button
                onClick={() => setRiskOnly(!riskOnly)}
                className={`w-full text-[10px] font-mono px-2 py-1.5 rounded-sm border transition-colors ${
                  riskOnly
                    ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/40'
                    : 'bg-ink-900 text-ink-400 border-white/10 hover:border-white/30'
                }`}
              >
                {riskOnly ? '● flagged only' : '○ all entities'}
              </button>

              <div className="border-t border-white/5 pt-2 mt-2 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-ink-500">find a path</div>
                <input
                  type="text"
                  placeholder="from…"
                  value={pathFrom}
                  onChange={(e) => setPathFrom(e.target.value)}
                  className="w-full bg-ink-900 border border-white/10 rounded-sm text-[11px] text-ink-50 placeholder:text-ink-600 focus:outline-none focus:border-white/30 px-2 py-1"
                />
                <input
                  type="text"
                  placeholder="to…"
                  value={pathTo}
                  onChange={(e) => setPathTo(e.target.value)}
                  className="w-full bg-ink-900 border border-white/10 rounded-sm text-[11px] text-ink-50 placeholder:text-ink-600 focus:outline-none focus:border-white/30 px-2 py-1"
                />
                {(pathFrom || pathTo) && (
                  <button
                    onClick={() => { setPathFrom(''); setPathTo(''); }}
                    className="text-[10px] font-mono text-ink-500 hover:text-ink-50 transition-colors"
                  >
                    clear path ×
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {tooltip && (
          <div
            className="absolute pointer-events-none bg-ink-900 border border-white/10 text-ink-50 text-xs rounded-sm px-3 py-2 shadow-2xl max-w-xs z-10"
            style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
          >
            <div className="font-medium">{tooltip.node.label}</div>
            <div className="text-ink-500 text-[10px] uppercase tracking-wider mt-0.5 font-mono">
              {tooltip.node.entityType} · {tooltip.node.degree} links
            </div>
            {tooltip.node.shellRisk && tooltip.node.shellRisk !== 'LOW' && (
              <div className="mt-1 text-signal-medium font-mono text-[10px]">SHELL RISK: {tooltip.node.shellRisk}</div>
            )}
            {tooltip.node.proximityScore && tooltip.node.proximityScore !== 'CLEAR' && (
              <div className="mt-1 text-signal-critical font-mono text-[10px]">PROXIMITY: {tooltip.node.proximityScore}</div>
            )}
            {tooltip.node.hasMatch && (
              <div className="mt-1 text-signal-critical font-mono text-[10px]">⚑ SANCTIONS MATCH</div>
            )}
          </div>
        )}

        {visibleNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-500 text-sm font-mono">
            / no entities match the current filters
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label, count, color, checked, onChange,
}: {
  label: string; count: number; color: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`w-full flex items-center justify-between px-2 py-1 rounded-sm text-[11px] transition-colors ${
        checked ? 'text-ink-50' : 'text-ink-600'
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: checked ? color : 'transparent',
            border: checked ? 'none' : `1px solid ${color}66`,
          }}
        />
        <span>{label}</span>
      </span>
      <span className="font-mono text-[10px] tabular-nums">{count.toLocaleString()}</span>
    </button>
  );
}
