'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EntitiesTab } from '../../../../components/tabs/EntitiesTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function EntitiesPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    // Fetch all types in parallel
    Promise.all([
      fetch(`${API}/api/investigations/${id}/entities?type=company&limit=200`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/entities?type=person&limit=200`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/entities?type=address&limit=200`).then((r) => r.json()),
    ])
      .then(([companies, persons, addresses]) => {
        setData({
          entities: {
            company: companies.items || [],
            person: persons.items || [],
            address: addresses.items || [],
          },
          totals: {
            company: companies.total || companies.items?.length || 0,
            person: persons.total || persons.items?.length || 0,
            address: addresses.total || addresses.items?.length || 0,
          },
        });
      })
      .catch(() => {});
  }, [id]);

  if (!data) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return <EntitiesTab entities={data.entities} totals={data.totals} investigationId={id} />;
}
