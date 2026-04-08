'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Investigation {
  id: string;
  query: string;
  status: 'QUEUED' | 'FETCHING' | 'COMPLETE' | 'FAILED';
  company?: any;
  officers?: any[];
  psc?: any[];
  error?: string;
}

export default function InvestigatePage() {
  const params = useParams();
  const id = params?.id as string;
  const [data, setData] = useState<Investigation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API}/api/investigations/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json);
        if (json.status !== 'COMPLETE' && json.status !== 'FAILED') {
          setTimeout(poll, 1500);
        }
      } catch (e: any) {
        setErr(e.message);
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [id]);

  if (err) return <main className="p-10 text-red-600">{err}</main>;
  if (!data) return <main className="p-10 text-slate-500">Loading...</main>;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <a href="/" className="text-sm text-blue-600 hover:underline">← New search</a>
      <h1 className="text-3xl font-bold mt-2">Investigation</h1>
      <p className="text-slate-500 mt-1">Query: {data.query}</p>
      <StatusBadge status={data.status} />

      {data.status === 'FAILED' && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {data.error || 'Investigation failed'}
        </div>
      )}

      {data.company && (
        <section className="mt-8 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold">{data.company.name}</h2>
          <p className="text-slate-500 text-sm">No. {data.company.companyNumber}</p>
          <dl className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <Field label="Status" value={data.company.status} />
            <Field label="Incorporated" value={data.company.incorporationDate} />
            <Field label="Type" value={data.company.companyType} />
            <Field label="Jurisdiction" value={data.company.jurisdiction} />
          </dl>
          {data.company.address && (
            <div className="mt-4 text-sm">
              <div className="text-slate-500">Registered office</div>
              <div>{[data.company.address.addressLine1, data.company.address.locality, data.company.address.postalCode].filter(Boolean).join(', ')}</div>
            </div>
          )}
          {data.company.sicCodes?.length > 0 && (
            <div className="mt-4 text-sm">
              <div className="text-slate-500">SIC codes</div>
              <div>{data.company.sicCodes.join(', ')}</div>
            </div>
          )}
        </section>
      )}

      {data.officers && data.officers.length > 0 && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Directors & Officers</h2>
          <ul className="space-y-4">
            {data.officers.map((o, i) => (
              <li key={i} className="border-b last:border-b-0 border-slate-100 pb-4 last:pb-0">
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-sm text-slate-500">{o.role}{o.nationality ? ` · ${o.nationality}` : ''}</div>
                  </div>
                  {o.resignedOn && <span className="text-xs text-slate-400">Resigned</span>}
                </div>
                {o.otherAppointments?.length > 0 && (
                  <div className="mt-2 ml-4 text-xs text-slate-600">
                    <div className="text-slate-400 mb-1">Other appointments ({o.otherAppointments.length}):</div>
                    <ul className="space-y-1">
                      {o.otherAppointments.slice(0, 10).map((a: any, j: number) => (
                        <li key={j}>• {a.companyName} <span className="text-slate-400">({a.companyNumber})</span></li>
                      ))}
                      {o.otherAppointments.length > 10 && <li className="text-slate-400">…and {o.otherAppointments.length - 10} more</li>}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.psc && data.psc.length > 0 && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Persons with Significant Control</h2>
          <ul className="space-y-3">
            {data.psc.map((p, i) => (
              <li key={i}>
                <div className="font-medium">{p.name}</div>
                {p.naturesOfControl?.length > 0 && (
                  <div className="text-sm text-slate-500">{p.naturesOfControl.join(', ')}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    QUEUED: 'bg-slate-100 text-slate-700',
    FETCHING: 'bg-blue-100 text-blue-700',
    COMPLETE: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block mt-3 px-3 py-1 rounded-full text-xs font-medium ${colors[status] || ''}`}>
      {status}
    </span>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value || '—'}</dd>
    </div>
  );
}
