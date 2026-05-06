'use client';
import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

interface Props {
  address: string;
  height?: number;
}

export function AddressMap({ address, height = 220 }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [coords, setCoords] = useState<{ lat: number; lng: number; displayName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setStatus('loading');
      try {
        const res = await fetch(`${API}/api/geocoding?q=${encodeURIComponent(address)}`);
        if (!res.ok) throw new Error('geocode failed');
        const data = await res.json();
        if (cancelled) return;
        if (!data.result) {
          setStatus('notfound');
          return;
        }
        setCoords(data.result);
        setStatus('ready');
      } catch {
        setStatus('error');
      }
    }
    load();
    return () => { cancelled = true; };
  }, [address]);

  useEffect(() => {
    if (status !== 'ready' || !coords || !mapRef.current) return;
    let map: any;
    let cancelled = false;
    (async () => {
      // Dynamic import keeps Leaflet out of the SSR bundle
      const L = await import('leaflet');
      // @ts-ignore · leaflet ships its own CSS
      await import('leaflet/dist/leaflet.css' as any).catch(() => {});
      if (cancelled || !mapRef.current) return;
      // Clear any prior instance
      // @ts-ignore
      if ((mapRef.current as any)._leaflet_id) (mapRef.current as any)._leaflet_id = null;
      mapRef.current.innerHTML = '';
      map = L.map(mapRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView([coords.lat, coords.lng], 16);
      const isLight = document.documentElement.classList.contains('light');
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${isLight ? 'light_all' : 'dark_all'}/{z}/{x}/{y}{r}.png`, {
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #FF4D4D;
          box-shadow: 0 0 14px rgba(255,77,77,0.7), 0 0 0 3px rgba(255,77,77,0.2);
          transform: translate(-7px, -7px);
        "></div>`,
      });
      L.marker([coords.lat, coords.lng], { icon }).addTo(map);
    })();
    return () => {
      cancelled = true;
      try { map?.remove(); } catch {}
    };
  }, [status, coords]);

  return (
    <div className="border border-white/5 bg-ink-900 overflow-hidden rounded-sm">
      <div ref={mapRef} style={{ height, width: '100%' }} />
      {status === 'loading' && (
        <div className="px-3 py-2 text-[10px] font-mono text-ink-500">/ geocoding…</div>
      )}
      {status === 'notfound' && (
        <div className="px-3 py-2 text-[10px] font-mono text-ink-500">/ location not found</div>
      )}
      {status === 'error' && (
        <div className="px-3 py-2 text-[10px] font-mono text-signal-critical">/ geocode error</div>
      )}
      {status === 'ready' && coords && (
        <div className="px-3 py-2 text-[10px] font-mono text-ink-500 border-t border-white/5 truncate">
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}  ·  {coords.displayName}
        </div>
      )}
    </div>
  );
}
