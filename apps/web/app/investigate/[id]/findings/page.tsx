'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FindingsTab } from '../../../../components/tabs/FindingsTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function FindingsPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`${API}/api/investigations/${id}/findings`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [id]);

  if (!data) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return (
    <FindingsTab
      findings={data.findings || []}
      entities={data.entities}
      relations={data.relations || {}}
      targetNodeId={data.targetNodeId}
      targetCompanyName={data.targetCompanyName}
      investigationId={id}
    />
  );
}
