'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import to keep Three.js out of the SSR bundle
const Globe3D = dynamic(
  () => import('./ui/3d-globe').then((m) => m.Globe3D),
  { ssr: false, loading: () => <div className="absolute inset-0" /> },
);

/** Generate a favicon URL from a company name */
function logoUrl(name?: string): string {
  if (!name) return '';
  const cleaned = name
    .toLowerCase()
    .replace(/[()[\].,&'"`]/g, '')
    .replace(/\b(plc|ltd|limited|llp|holdings|group|company|co|inc|corp|corporation|the)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return '';
  return `https://www.google.com/s2/favicons?domain=${cleaned}.com&sz=128`;
}

interface Marker {
  location: [number, number];
  size: number;
  label?: string;
}

interface Props {
  markers?: Marker[];
}

/**
 * Renders the Aceternity Globe3D positioned absolutely so the parent card
 * can crop the bottom of the sphere - the signature aceternity "half-globe
 * rising from the bottom" look. Parent must be `relative` and `overflow-hidden`.
 */
export function NetworkGlobe({ markers = [] }: Props) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains('light'));
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains('light'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const adapted = markers.map((m, i) => ({
    lat: m.location[0],
    lng: m.location[1],
    label: m.label || `marker-${i}`,
    src: logoUrl(m.label),
    size: m.size,
  }));

  if (adapted.length === 0) {
    adapted.push({
      lat: 51.5074,
      lng: -0.1278,
      label: 'London',
      src: logoUrl('London'),
      size: 0.05,
    });
  }

  return (
    <Globe3D
      className="!absolute -bottom-[80%] left-1/2 -translate-x-1/2 !h-[150%] !w-[150%]"
      markers={adapted}
      config={isLight ? {
        showAtmosphere: true,
        atmosphereColor: '#93C5FD',
        atmosphereIntensity: 0.3,
        bumpScale: 3,
        autoRotateSpeed: 0.4,
        enableZoom: false,
        enablePan: false,
        backgroundColor: null,
        ambientIntensity: 1.8,
        pointLightIntensity: 0.8,
        markerSize: 0.04,
        globeColor: '#E0E7FF',
        showWireframe: true,
        wireframeColor: '#CBD5E1',
      } : {
        showAtmosphere: false,
        bumpScale: 5,
        autoRotateSpeed: 0.4,
        enableZoom: false,
        enablePan: false,
        backgroundColor: null,
        ambientIntensity: 0.5,
        pointLightIntensity: 1.5,
        markerSize: 0.04,
      }}
    />
  );
}
