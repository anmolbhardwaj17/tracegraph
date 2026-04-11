'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { LocationsMap } from '../../../../components/LocationsMap';
import dynamic from 'next/dynamic';

const LocationsGlobe = dynamic(
  () => import('../../../../components/LocationsGlobe').then((m) => m.LocationsGlobe),
  { ssr: false, loading: () => <div className="h-[580px] bg-ink-900 animate-pulse" /> },
);

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LocationsPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [view, setView] = useState<'globe' | 'map'>('globe');
  const [selectedPoint, setSelectedPoint] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/locations`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([loc, m]) => { setData(loc); setMeta(m); })
      .catch(() => {});
  }, [id]);

  // Build globe points from address data
  const { globePoints, globeArcs, targetLat, targetLng } = useMemo(() => {
    if (!data) return { globePoints: [], globeArcs: [], targetLat: undefined, targetLng: undefined };

    const addresses = data.addresses || [];
    const edges = data.edges || [];
    const companies = data.companies?.company || [];
    const targetNumber = meta?.rootCompanyNumber;

    // Find target company's address
    const targetCo = companies.find((c: any) => c.entityId === targetNumber);
    let targetAddrId: string | null = null;
    if (targetCo) {
      for (const e of edges) {
        if (e.source === targetCo.id || e.target === targetCo.id) {
          targetAddrId = e.source === targetCo.id ? e.target : e.source;
          break;
        }
      }
    }

    const points: any[] = [];
    let tLat: number | undefined;
    let tLng: number | undefined;

    for (const a of addresses) {
      const geo = a.metadata?.geo;
      if (!geo?.lat || !geo?.lng) continue;
      const isTarget = a.id === targetAddrId;
      if (isTarget) { tLat = geo.lat; tLng = geo.lng; }
      points.push({
        id: a.id,
        lat: geo.lat,
        lng: geo.lng,
        label: a.label,
        density: a.metadata?.addressAnalysis?.density || a.metadata?.companyCount || 1,
        flag: a.metadata?.addressAnalysis?.flag || a.metadata?.addressAnalysis?.classification,
        isTarget,
        companies: [],
      });
    }

    // Build arcs from target address to other addresses (connected via shared directors)
    const arcs: any[] = [];
    if (tLat != null && tLng != null) {
      for (const p of points) {
        if (p.isTarget || !p.lat || !p.lng) continue;
        // Only draw arc if there's a meaningful connection
        if (p.flag === 'VIRTUAL_OFFICE' || p.flag === 'HIGH_DENSITY' || p.density >= 3) {
          arcs.push({
            startLat: tLat, startLng: tLng,
            endLat: p.lat, endLng: p.lng,
            color: p.flag === 'VIRTUAL_OFFICE' ? 'rgba(239,68,68,0.4)' :
              p.flag === 'HIGH_DENSITY' ? 'rgba(245,158,11,0.3)' :
              'rgba(107,114,128,0.2)',
          });
        }
      }
    }

    return { globePoints: points, globeArcs: arcs, targetLat: tLat, targetLng: tLng };
  }, [data, meta]);

  if (!data) return <div className="animate-pulse h-[580px] bg-white/5 rounded-sm" />;

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">
          / Locations - {(data.addresses || []).length} addresses
        </div>
        <div className="flex items-center gap-1 bg-ink-900/95 border border-white/10 rounded-sm overflow-hidden">
          <button
            onClick={() => setView('globe')}
            className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 transition-colors ${view === 'globe' ? 'bg-white/10 text-ink-50' : 'text-ink-500 hover:text-ink-200'}`}
          >
            Globe
          </button>
          <button
            onClick={() => setView('map')}
            className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 transition-colors ${view === 'map' ? 'bg-white/10 text-ink-50' : 'text-ink-500 hover:text-ink-200'}`}
          >
            Map
          </button>
        </div>
      </div>

      {/* Globe view */}
      {view === 'globe' && (
        <div className="border border-white/5 bg-ink-900 overflow-hidden rounded-sm">
          <LocationsGlobe
            points={globePoints}
            arcs={globeArcs}
            targetLat={targetLat}
            targetLng={targetLng}
            onPointClick={setSelectedPoint}
            height={580}
          />
        </div>
      )}

      {/* Map view */}
      {view === 'map' && (
        <LocationsMap
          addresses={data.addresses || []}
          edges={data.edges || []}
          allEntities={data.companies}
          targetCompanyName={meta?.companyName}
          targetCompanyNumber={meta?.rootCompanyNumber}
        />
      )}

      {/* Selected point detail (globe mode) */}
      {view === 'globe' && selectedPoint && (
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">/ Address</div>
            <button onClick={() => setSelectedPoint(null)} className="text-ink-500 hover:text-ink-50 text-lg leading-none">x</button>
          </div>
          <h3 className="font-medium text-ink-50 text-sm break-words">{selectedPoint.label}</h3>
          <div className="text-[10px] font-mono text-ink-500 mt-1">
            {selectedPoint.lat?.toFixed(4)}, {selectedPoint.lng?.toFixed(4)}
          </div>
          <div className="flex gap-4 mt-3 text-xs">
            <div>
              <span className="text-ink-500">Companies: </span>
              <span className={selectedPoint.density >= 5 ? 'text-signal-critical' : 'text-ink-50'}>{selectedPoint.density}</span>
            </div>
            {selectedPoint.flag && selectedPoint.flag !== 'NORMAL' && (
              <div>
                <span className="text-ink-500">Flag: </span>
                <span className="text-signal-critical">{selectedPoint.flag.replace('_', ' ').toLowerCase()}</span>
              </div>
            )}
            {selectedPoint.isTarget && <span className="text-[9px] font-mono text-white bg-white/10 px-1.5 py-0.5 rounded-sm">TARGET</span>}
          </div>
        </div>
      )}
    </div>
  );
}
