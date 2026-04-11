'use client';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';

const Globe = dynamic(() => import('react-globe.gl').then((m) => m.default), { ssr: false });

interface GlobePoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  density: number;
  flag?: string;
  isTarget: boolean;
  companies?: string[];
}

interface GlobeArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
}

interface Props {
  points: GlobePoint[];
  arcs?: GlobeArc[];
  targetLat?: number;
  targetLng?: number;
  onPointClick?: (point: GlobePoint) => void;
  height?: number;
}

export function LocationsGlobe({ points, arcs = [], targetLat, targetLng, onPointClick, height = 580 }: Props) {
  const globeRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Auto-rotate to target on load
  useEffect(() => {
    if (!ready || !globeRef.current) return;
    const globe = globeRef.current;
    if (targetLat != null && targetLng != null) {
      setTimeout(() => {
        globe.pointOfView({ lat: targetLat, lng: targetLng, altitude: 1.8 }, 1500);
      }, 500);
    }
  }, [ready, targetLat, targetLng]);

  const pointColor = useCallback((d: any) => {
    if (d.isTarget) return '#FFFFFF';
    if (d.flag === 'VIRTUAL_OFFICE') return '#EF4444';
    if (d.flag === 'HIGH_DENSITY') return '#F59E0B';
    return '#6B7280';
  }, []);

  const pointAlt = useCallback((d: any) => d.isTarget ? 0.04 : d.flag ? 0.025 : 0.01, []);
  const pointRadius = useCallback((d: any) => d.isTarget ? 0.5 : Math.max(0.15, Math.min(0.6, 0.1 + Math.sqrt(d.density) * 0.08)), []);
  const pointLabel = useCallback((d: any) => `<div style="font-family:ui-monospace,monospace;font-size:11px;color:#F5F5F5;background:rgba(10,10,10,0.9);padding:6px 10px;border:1px solid rgba(255,255,255,0.1);border-radius:2px;">
    <div style="font-weight:500;margin-bottom:2px;">${d.label}</div>
    <div style="color:#737373;font-size:9px;">${d.density} compan${d.density === 1 ? 'y' : 'ies'}${d.flag ? ' - ' + d.flag.replace('_', ' ').toLowerCase() : ''}</div>
  </div>`, []);

  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <Globe
        ref={globeRef}
        onGlobeReady={() => setReady(true)}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl=""
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere={true}
        atmosphereColor="#1a3a5c"
        atmosphereAltitude={0.15}
        pointsData={points}
        pointLat="lat"
        pointLng="lng"
        pointColor={pointColor}
        pointAltitude={pointAlt}
        pointRadius={pointRadius}
        pointLabel={pointLabel}
        onPointClick={(p: any) => onPointClick?.(p)}
        arcsData={arcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke={0.5}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={1500}
        arcAltitudeAutoScale={0.3}
        ringsData={targetLat != null ? [{ lat: targetLat, lng: targetLng }] : []}
        ringLat="lat"
        ringLng="lng"
        ringColor={() => '#FFFFFF'}
        ringMaxRadius={2}
        ringPropagationSpeed={1}
        ringRepeatPeriod={1500}
        width={undefined as any}
        height={height}
      />
    </div>
  );
}

/** Small decorative globe for the landing page hero */
export function DecorativeGlobe() {
  const decorativeArcs = useMemo(() => [
    { startLat: 51.5, startLng: -0.1, endLat: 40.7, endLng: -74.0, color: 'rgba(94,230,161,0.3)' },
    { startLat: 51.5, startLng: -0.1, endLat: 25.2, endLng: 55.3, color: 'rgba(245,197,24,0.2)' },
    { startLat: 51.5, startLng: -0.1, endLat: 1.3, endLng: 103.8, color: 'rgba(94,230,161,0.2)' },
    { startLat: 51.5, startLng: -0.1, endLat: -33.9, endLng: 18.4, color: 'rgba(245,197,24,0.15)' },
    { startLat: 40.7, startLng: -74.0, endLat: 18.5, endLng: -64.9, color: 'rgba(255,77,77,0.2)' },
  ], []);

  return (
    <div style={{ width: 400, height: 400 }}>
      <Globe
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        backgroundColor="rgba(0,0,0,0)"
        showAtmosphere={true}
        atmosphereColor="#1a3a5c"
        atmosphereAltitude={0.12}
        arcsData={decorativeArcs}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor="color"
        arcStroke={0.4}
        arcDashLength={0.4}
        arcDashGap={0.2}
        arcDashAnimateTime={2000}
        arcAltitudeAutoScale={0.4}
        enablePointerInteraction={false}
        width={400}
        height={400}
      />
    </div>
  );
}
