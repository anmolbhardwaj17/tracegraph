'use client';
import dynamic from 'next/dynamic';

// Dynamically import to keep Three.js out of the SSR bundle
const Globe3D = dynamic(
  () => import('./ui/3d-globe').then((m) => m.Globe3D),
  { ssr: false, loading: () => <div className="absolute inset-0" /> },
);

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
  const adapted = markers.map((m, i) => ({
    lat: m.location[0],
    lng: m.location[1],
    label: m.label || `marker-${i}`,
    src: '',
    size: m.size,
  }));

  if (adapted.length === 0) {
    adapted.push({
      lat: 51.5074,
      lng: -0.1278,
      label: 'London',
      src: '',
      size: 0.05,
    });
  }

  return (
    <Globe3D
      className="!absolute -bottom-[80%] left-1/2 -translate-x-1/2 !h-[150%] !w-[150%]"
      markers={adapted}
      config={{
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
