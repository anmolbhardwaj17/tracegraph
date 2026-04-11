'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LocationsMap } from '../../../../components/LocationsMap';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LocationsPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/locations`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([loc, m]) => { setData(loc); setMeta(m); })
      .catch(() => {});
  }, [id]);

  if (!data) return <div className="animate-pulse h-[580px] bg-white/5 rounded-sm" />;
  return (
    <LocationsMap
      addresses={data.addresses || []}
      edges={data.edges || []}
      allEntities={data.companies}
      targetCompanyName={meta?.companyName}
      targetCompanyNumber={meta?.rootCompanyNumber}
    />
  );
}
