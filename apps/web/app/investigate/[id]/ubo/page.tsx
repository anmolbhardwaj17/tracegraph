'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { UBOTab } from '../../../../components/tabs/UBOTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export default function UboPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/ubo`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/findings`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([ubo, findingsData, meta]) => {
        setData({
          chains: ubo.chains || [],
          findings: findingsData.findings || [],
          entities: findingsData.entities,
          targetCompanyName: meta?.companyName,
        });
      })
      .catch(() => setData({ chains: [], findings: [], entities: null }));
  }, [id]);

  if (!data) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return (
    <UBOTab
      chains={data.chains}
      findings={data.findings}
      entities={data.entities}
      targetCompanyName={data.targetCompanyName}
    />
  );
}
