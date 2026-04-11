'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EntitiesTab } from '../../../../components/tabs/EntitiesTab';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function EntitiesPage() {
  const { id } = useParams() as { id: string };
  const [entities, setEntities] = useState<any>(null);

  useEffect(() => {
    // Fetch all types in parallel
    Promise.all([
      fetch(`${API}/api/investigations/${id}/entities?type=company&limit=200`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/entities?type=person&limit=200`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/entities?type=address&limit=200`).then((r) => r.json()),
    ])
      .then(([companies, persons, addresses]) => {
        setEntities({
          company: companies.items || [],
          person: persons.items || [],
          address: addresses.items || [],
        });
      })
      .catch(() => {});
  }, [id]);

  if (!entities) return <div className="animate-pulse h-64 bg-white/5 rounded-sm" />;
  return <EntitiesTab entities={entities} investigationId={id} />;
}
