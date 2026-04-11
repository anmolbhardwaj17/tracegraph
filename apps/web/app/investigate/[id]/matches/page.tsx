'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MatchesTab } from '../../../../components/tabs/MatchesTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function MatchesPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/matches`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/meta`).then((r) => r.json()),
    ])
      .then(([m, mt]) => { setData(m); setMeta(mt); })
      .catch(() => {});
  }, [id]);

  if (!data) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return <MatchesTab matches={data.matches || []} counts={meta?.counts} />;
}
