'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface AddressEntity {
  id: string;
  entityId: string;
  label: string;
  metadata?: any;
  proximityScore?: string;
}

interface Geocoded {
  id: string;
  label: string;
  lat: number;
  lng: number;
  displayName: string;
  density: number;
  flag?: string;
  companies?: string[];
}

interface Props {
  addresses: AddressEntity[];
  edges?: any[];
  allEntities?: any;
  targetCompanyName?: string;
  targetCompanyNumber?: string;
}

export function LocationsMap({ addresses, edges = [], allEntities, targetCompanyName, targetCompanyNumber }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Geocoded[]>([]);
  const [selected, setSelected] = useState<Geocoded | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const mapInstanceRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [showVirtual, setShowVirtual] = useState(true);
  const [showHigh, setShowHigh] = useState(true);
  const [showNormal, setShowNormal] = useState(true);

  // Build a map of address-id -> companies linked to it
  const addressToCompanies = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!allEntities?.company) return map;
    const companyById = new Map<string, any>();
    for (const c of allEntities.company || []) companyById.set(c.id, c);
    for (const e of edges) {
      if (e.type !== 'address') continue;
      const cId = companyById.has(e.source) ? e.source : companyById.has(e.target) ? e.target : null;
      const aId = !cId ? null : (e.source === cId ? e.target : e.source);
      if (!cId || !aId) continue;
      const list = map.get(aId) || [];
      list.push(companyById.get(cId).label);
      map.set(aId, list);
    }
    return map;
  }, [edges, allEntities]);

  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      const results: Geocoded[] = [];
      const needsFetch: AddressEntity[] = [];

      for (const a of addresses) {
        const geo = a.metadata?.geo;
        if (geo?.lat != null && geo?.lng != null) {
          results.push({
            id: a.id,
            label: a.label,
            lat: geo.lat,
            lng: geo.lng,
            displayName: geo.displayName || a.label,
            density: a.metadata?.companyCount || a.metadata?.addressAnalysis?.density || 1,
            flag: a.metadata?.addressAnalysis?.flag,
            companies: addressToCompanies.get(a.id) || [],
          });
        } else {
          needsFetch.push(a);
        }
      }

      setProgress({ done: results.length, total: addresses.length });
      if (!cancelled) setPoints([...results]);

      for (let i = 0; i < needsFetch.length; i++) {
        if (cancelled) return;
        const a = needsFetch[i];
        try {
          const res = await fetch(`${API}/api/geocoding?q=${encodeURIComponent(a.label)}`);
          const data = await res.json();
          if (data.result) {
            results.push({
              id: a.id,
              label: a.label,
              lat: data.result.lat,
              lng: data.result.lng,
              displayName: data.result.displayName,
              density: a.metadata?.companyCount || a.metadata?.addressAnalysis?.density || 1,
              flag: a.metadata?.addressAnalysis?.flag || a.metadata?.addressAnalysis?.classification,
              companies: addressToCompanies.get(a.id) || [],
            });
          }
        } catch { /* skip */ }
        setProgress({ done: results.length, total: addresses.length });
      }
      if (!cancelled) setPoints([...results]);
    }
    if (addresses.length > 0) loadAll();
    return () => { cancelled = true; };
  }, [addresses, addressToCompanies]);

  // ----- Filtered points -----
  const filteredPoints = useMemo(() => {
    return points.filter((p) => {
      const flag = p.flag || 'NORMAL';
      if (flag === 'VIRTUAL_OFFICE' && !showVirtual) return false;
      if (flag === 'HIGH_DENSITY' && !showHigh) return false;
      if (flag !== 'VIRTUAL_OFFICE' && flag !== 'HIGH_DENSITY' && !showNormal) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!p.label.toLowerCase().includes(q) && !p.displayName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [points, showVirtual, showHigh, showNormal, search]);

  // ----- Hot-spots: ranked list (flagged first, then by density) -----
  const hotSpots = useMemo(() => {
    const sevRank = (p: Geocoded) =>
      p.flag === 'VIRTUAL_OFFICE' || p.flag === 'FORMATION_AGENT' ? 3 : p.flag === 'HIGH_DENSITY' ? 2 : p.density >= 3 ? 1 : 0;
    return [...filteredPoints]
      .sort((a, b) => sevRank(b) - sevRank(a) || b.density - a.density)
      .slice(0, 12);
  }, [filteredPoints]);

  // ----- Render the map -----
  useEffect(() => {
    if (filteredPoints.length === 0 || !mapRef.current) return;
    let cancelled = false;
    (async () => {
      const L = await import('leaflet');
      LRef.current = L;
      // @ts-ignore
      await import('leaflet/dist/leaflet.css' as any).catch(() => {});
      if (cancelled || !mapRef.current) return;

      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch {}
        mapInstanceRef.current = null;
      }
      mapRef.current.innerHTML = '';

      const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false });
      mapInstanceRef.current = map;

      const isLight = document.documentElement.classList.contains('light');
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${isLight ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`, {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      markerLayerRef.current = layer;

      const bounds = L.latLngBounds([]);
      for (const p of filteredPoints) {
        const isTarget = targetAddress && p.id === targetAddress.id;
        const radius = isTarget ? 18 : Math.max(8, Math.min(28, 6 + Math.sqrt(p.density) * 4));
        const color = isTarget ? '#FFFFFF' :
          p.flag === 'VIRTUAL_OFFICE' || p.flag === 'FORMATION_AGENT' ? '#FF4D4D' :
          p.flag === 'HIGH_DENSITY' ? '#F5C518' :
          '#A0A0A0';

        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width: ${radius * 2}px; height: ${radius * 2}px;
            border-radius: 50%;
            background: ${isTarget ? 'rgba(255,255,255,0.15)' : `${color}40`};
            border: ${isTarget ? '3px' : '2px'} solid ${color};
            box-shadow: 0 0 ${isTarget ? 20 : radius}px ${color}${isTarget ? 'AA' : '66'};
            display: flex; align-items: center; justify-content: center;
            color: #F5F5F5; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 600;
            transform: translate(-${radius}px, -${radius}px);
          ">${isTarget ? '★' : (p.density > 1 ? p.density : '')}</div>`,
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(layer);
        marker.on('click', () => setSelected(p));

        // Always show label for target
        if (isTarget && targetCompanyName) {
          const labelIcon = L.divIcon({
            className: '',
            html: `<div style="
              white-space: nowrap; font-size: 11px; font-weight: 500; color: #F5F5F5;
              font-family: ui-monospace, monospace; text-shadow: 0 1px 4px rgba(0,0,0,0.8);
              transform: translate(${radius + 6}px, -8px);
            ">${targetCompanyName}</div>`,
          });
          L.marker([p.lat, p.lng], { icon: labelIcon, interactive: false }).addTo(layer);
        }
        bounds.extend([p.lat, p.lng]);
      }

      if (bounds.isValid()) {
        // Center on target address if available, otherwise fit all
        if (targetAddress) {
          map.setView([targetAddress.lat, targetAddress.lng], 12);
        } else {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.remove(); } catch {}
        mapInstanceRef.current = null;
      }
    };
  }, [filteredPoints]);

  // Fly to selected hot-spot
  const flyTo = (p: Geocoded) => {
    setSelected(p);
    const map = mapInstanceRef.current;
    if (map) {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    }
  };

  // ----- Stats with concentration insight -----
  const stats = useMemo(() => {
    const totalCompanies = points.reduce((s, p) => s + p.density, 0);
    const virtualOffices = points.filter((p) => p.flag === 'VIRTUAL_OFFICE' || p.flag === 'FORMATION_AGENT').length;
    const highDensity = points.filter((p) => p.flag === 'HIGH_DENSITY').length;
    const sortedByDensity = [...points].sort((a, b) => b.density - a.density);
    const top3Companies = sortedByDensity.slice(0, 3).reduce((s, p) => s + p.density, 0);
    const concentration = totalCompanies > 0 ? Math.round((top3Companies / totalCompanies) * 100) : 0;
    // Unique regions = naive: take part after first comma in displayName
    const regions = new Set<string>();
    for (const p of points) {
      const region = (p.displayName || '').split(',').slice(-2, -1)[0]?.trim();
      if (region) regions.add(region.toLowerCase());
    }
    return {
      totalCompanies,
      virtualOffices,
      highDensity,
      addressCount: points.length,
      concentration,
      uniqueRegions: regions.size,
    };
  }, [points]);

  // Identify target company's address
  const targetAddress = useMemo(() => {
    if (!targetCompanyNumber || !allEntities?.company) return null;
    const targetCo = (allEntities.company || []).find((c: any) =>
      c.entityId === targetCompanyNumber || c.label?.toUpperCase().includes((targetCompanyName || '').toUpperCase()),
    );
    if (!targetCo) return null;
    // Find address edge for target company
    for (const e of edges) {
      if (e.type !== 'address') continue;
      if (e.source === targetCo.id || e.target === targetCo.id) {
        const addrId = e.source === targetCo.id ? e.target : e.source;
        return points.find((p) => p.id === addrId) || null;
      }
    }
    return null;
  }, [targetCompanyNumber, targetCompanyName, allEntities, edges, points]);

  // Plain English location summary
  const locationSummary = useMemo(() => {
    if (points.length === 0) return '';
    const parts: string[] = [];
    if (targetAddress && targetCompanyName) {
      if (targetAddress.flag === 'VIRTUAL_OFFICE') {
        parts.push(`${targetCompanyName} is registered at ${targetAddress.label} - this address hosts ${targetAddress.density} other companies and is classified as a virtual office.`);
      } else if (targetAddress.density > 5) {
        parts.push(`${targetCompanyName} is registered at ${targetAddress.label} - this address hosts ${targetAddress.density} companies.`);
      } else {
        parts.push(`${targetCompanyName} is registered at ${targetAddress.label}${targetAddress.density <= 1 ? ' - no other companies at this address.' : '.'}`);
      }
    }
    if (stats.uniqueRegions > 1) {
      parts.push(`Network spans ${stats.uniqueRegions} regions${stats.concentration >= 50 ? `, with ${stats.concentration}% concentration in the top 3 addresses` : ''}.`);
    }
    if (stats.virtualOffices > 0) {
      parts.push(`${stats.virtualOffices} virtual office${stats.virtualOffices > 1 ? 's' : ''} detected.`);
    }
    return parts.join(' ');
  }, [points, targetAddress, targetCompanyName, stats]);

  // Depth filter
  const [depthFilter, setDepthFilter] = useState<'all' | 'direct' | 'target'>('all');

  if (addresses.length === 0) {
    return (
      <div className="text-center py-16 text-ink-500 text-sm font-mono">
        / no addresses in this network
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary + stats in one row */}
      <div className="flex flex-col lg:flex-row gap-4">
        {locationSummary && (
          <div className="lg:flex-1 border border-white/5 bg-ink-850 px-6 py-4 text-sm text-ink-300 leading-relaxed flex items-center">
            {locationSummary}
          </div>
        )}
        <div className="flex gap-px bg-white/5 border border-white/5 shrink-0">
          <Stat label="Addresses" value={String(stats.addressCount)} />
          <Stat label="Virtual" value={String(stats.virtualOffices)} highlight={stats.virtualOffices > 0} />
          <Stat label="Regions" value={String(stats.uniqueRegions)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:items-start">
        {/* Hot-spots panel */}
        <aside className="lg:col-span-1 border border-white/5 bg-ink-850 p-5 space-y-4 flex flex-col" style={{ height: 560 }}>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">/ Hot spots</div>
            <div className="text-[10px] font-mono text-ink-600">click to fly the map to it</div>
          </div>

          <input
            type="text"
            placeholder="search address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 bg-ink-900 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
          />

          <div className="flex flex-wrap gap-1.5">
            <FlagChip label="virtual" color="#FF4D4D" active={showVirtual} onClick={() => setShowVirtual(!showVirtual)} />
            <FlagChip label="high-density" color="#F5C518" active={showHigh} onClick={() => setShowHigh(!showHigh)} />
            <FlagChip label="normal" color="#A0A0A0" active={showNormal} onClick={() => setShowNormal(!showNormal)} />
          </div>

          {hotSpots.length === 0 ? (
            <div className="text-xs font-mono text-ink-500 py-4 border border-dashed border-white/5 px-3">
              no addresses match the current filters
            </div>
          ) : (
            <div className="space-y-1 flex-1 overflow-y-auto -mr-2 pr-2 min-h-0">
              {hotSpots.map((p) => {
                const active = selected?.id === p.id;
                const dotColor =
                  p.flag === 'VIRTUAL_OFFICE' || p.flag === 'FORMATION_AGENT' ? '#FF4D4D' :
                  p.flag === 'HIGH_DENSITY' ? '#F5C518' :
                  '#737373';
                return (
                  <button
                    key={p.id}
                    onClick={() => flyTo(p)}
                    className={`w-full text-left px-3 py-2 rounded-sm border transition-colors ${
                      active
                        ? 'bg-ink-900 border-white/30'
                        : 'bg-ink-900/40 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                      <span className="text-[9px] font-mono uppercase tracking-wider text-ink-500">
                        {p.flag || 'normal'}
                      </span>
                      <span className="text-[9px] font-mono text-ink-600 ml-auto tabular-nums">
                        {p.density}× co
                      </span>
                    </div>
                    <div className={`text-xs leading-snug truncate ${active ? 'text-ink-50' : 'text-ink-300'}`}>
                      {p.label}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

        </aside>

        {/* Map + side detail */}
        <div className="lg:col-span-3 space-y-3">
          <div className="border border-white/5 bg-ink-900 overflow-hidden relative" style={{ height: 560 }}>
            {points.length === 0 ? (
              <div className="h-full flex items-center justify-center text-ink-500 text-sm font-mono">
                / geocoding addresses… {progress.done} / {progress.total}
              </div>
            ) : (
              <>
                <div ref={mapRef} className="w-full h-full" />
                {/* Legend overlay */}
                <div className="absolute bottom-3 left-3 z-[400] bg-ink-900/90 backdrop-blur border border-white/10 rounded-sm px-3 py-2 text-[9px] font-mono text-ink-500 flex items-center gap-3">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full border border-signal-critical bg-signal-critical/30" /> Virtual</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full border border-signal-medium bg-signal-medium/30" /> Density</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full border border-ink-300 bg-ink-300/30" /> Normal</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full border-2 border-white bg-white/15" /> Target</span>
                  {targetAddress && (
                    <button onClick={() => { const map = mapInstanceRef.current; if (map) map.flyTo([targetAddress.lat, targetAddress.lng], 14, { duration: 0.8 }); setSelected(targetAddress); }}
                      className="text-ink-400 hover:text-ink-50 transition-colors ml-1">show target</button>
                  )}
                </div>
                {selected && (
                  <aside className="absolute top-3 right-3 w-72 max-h-[calc(100%-1.5rem)] overflow-auto border border-white/10 bg-ink-900/95 backdrop-blur-md p-5 shadow-2xl z-[400]">
                    <div className="flex items-start justify-between mb-3">
                      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">/ Address</div>
                      <button onClick={() => setSelected(null)} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">×</button>
                    </div>
                    <h3 className="font-medium text-ink-50 break-words text-sm">{selected.label}</h3>
                    <div className="text-[10px] font-mono text-ink-500 mt-2">
                      {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                    </div>
                    <div className="text-[10px] font-mono text-ink-500 mt-1 break-words">{selected.displayName}</div>

                    <dl className="mt-4 space-y-2 text-sm border-t border-white/5 pt-3">
                      <Field label="Companies here" value={String(selected.density)} highlight={selected.density >= 5} />
                      {selected.flag && selected.flag !== 'NORMAL' && (
                        <Field label="Flag" value={selected.flag} highlight />
                      )}
                    </dl>

                    {/* Comparison with target address */}
                    {targetAddress && selected.id !== targetAddress.id && targetCompanyName && (
                      <div className="mt-3 pt-3 border-t border-white/5 text-[10px] font-mono text-ink-500 space-y-1">
                        <div className="text-ink-400">vs {targetCompanyName}:</div>
                        {targetAddress.density > 0 && selected.density > 0 && (
                          <div>{selected.density > targetAddress.density
                            ? `${Math.round(selected.density / Math.max(targetAddress.density, 1))}x more companies than target address`
                            : 'Fewer companies than target address'
                          }</div>
                        )}
                        {selected.flag && selected.flag !== 'NORMAL' && !targetAddress.flag && (
                          <div className="text-signal-critical">Flagged address - target address is not flagged</div>
                        )}
                      </div>
                    )}

                    {selected.companies && selected.companies.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Registered here</div>
                        <ul className="space-y-1 max-h-48 overflow-auto">
                          {selected.companies.slice(0, 30).map((c, i) => (
                            <li key={i} className="text-xs text-ink-300 truncate">› {c}</li>
                          ))}
                          {selected.companies.length > 30 && (
                            <li className="text-[10px] text-ink-500 font-mono">…and {selected.companies.length - 30} more</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </aside>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight, sub }: { label: string; value: string; highlight?: boolean; sub?: string }) {
  return (
    <div className={`bg-ink-850 p-5 ${highlight ? 'border-l-2 border-signal-critical' : ''}`}>
      <div className="text-2xl font-medium text-ink-50 tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-2 font-mono">{label}</div>
      {sub && <div className="text-[10px] text-ink-600 mt-0.5 font-mono">{sub}</div>}
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider font-mono">{label}</dt>
      <dd className={`text-xs font-medium text-right ${highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</dd>
    </div>
  );
}

function FlagChip({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] font-mono px-2 py-1 rounded-sm border transition-colors ${
        active ? 'bg-ink-900 border-white/20 text-ink-50' : 'bg-ink-900/40 border-white/5 text-ink-600'
      }`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ backgroundColor: active ? color : 'transparent', border: active ? 'none' : `1px solid ${color}66` }} />
      {label}
    </button>
  );
}
