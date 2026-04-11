'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { UBOTab } from '../../../../components/tabs/UBOTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function UboPage() {
  const { id } = useParams() as { id: string };
  const [chains, setChains] = useState<any[] | null>(null);

  useEffect(() => {
    fetch(`${API}/api/investigations/${id}/ubo`)
      .then((r) => r.json())
      .then((d) => setChains(d.chains || []))
      .catch(() => setChains([]));
  }, [id]);

  if (chains === null) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return <UBOTab chains={chains} />;
}
