'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Globe, Calendar, MapPin, Users, DollarSign, Link2, Mail, ArrowRight, ExternalLink } from 'lucide-react';
import { NavBar } from '../../components/NavBar';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

function DomainResearchContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const url = sp.get('url') || '';
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    fetch(`${API}/api/jurisdictions/domain-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError('Research failed'))
      .finally(() => setLoading(false));
  }, [url]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <div className="w-8 h-8 border-2 border-ink-700 border-t-[#d4ff00] rounded-full animate-spin" />
      <div className="space-y-1 text-center">
        <div className="text-sm text-ink-300">Researching {url}...</div>
        <div className="text-[10px] font-mono text-ink-600">Scraping website · WHOIS · Wayback · LLM extraction</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="py-24 text-center">
      <div className="text-sm text-signal-critical mb-2">{error}</div>
      <button onClick={() => router.back()} className="text-xs font-mono text-ink-500 hover:text-ink-300 transition-colors">← Back</button>
    </div>
  );

  if (!data) return null;

  const whoisCreated = data.whois?.createdDate ? new Date(data.whois.createdDate) : null;
  const waybackFirst = data.wayback?.firstSeen ? new Date(data.wayback.firstSeen) : null;

  return (
    <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">Web research</div>
          <h1 className="text-2xl font-medium text-ink-50">{data.companyName || data.domain}</h1>
          <a href={`https://${data.domain}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-ink-500 hover:text-ink-300 mt-1 transition-colors">
            <Globe size={10} />{data.domain} <ExternalLink size={9} />
          </a>
        </div>
        {/* Start investigation CTA */}
        <Link
          href={`/start?company=${encodeURIComponent(data.companyName || data.domain)}&jurisdiction=all`}
          className="flex items-center gap-2 px-4 py-2.5 bg-ink-50 text-ink-900 text-xs font-medium hover:bg-white transition-colors"
        >
          Investigate this company <ArrowRight size={12} />
        </Link>
      </div>

      {/* Description */}
      {data.description && (
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-2">About</div>
          <p className="text-sm text-ink-200 leading-relaxed">{data.description}</p>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {data.industry && (
              <span className="text-[10px] font-mono text-ink-500">{data.industry}</span>
            )}
            {data.location && (
              <span className="flex items-center gap-1 text-[10px] font-mono text-ink-500">
                <MapPin size={9} />{data.location}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-white/5 border border-white/5">
        <Stat label="Domain age" value={data.wayback?.ageYears != null ? `${data.wayback.ageYears} years` : '—'} icon={<Calendar size={12} />} />
        <Stat label="First seen online" value={waybackFirst ? waybackFirst.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'} icon={<Globe size={12} />} />
        <Stat label="Wayback snapshots" value={data.wayback?.totalSnapshots > 0 ? String(data.wayback.totalSnapshots) : '—'} icon={<Globe size={12} />} />
        <Stat label="Domain registered" value={whoisCreated ? whoisCreated.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—'} icon={<Calendar size={12} />} />
      </div>

      {/* Founders & Team */}
      {(data.founders?.length > 0 || data.teamMembers?.length > 0) && (
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3 flex items-center gap-1">
            <Users size={10} />People
          </div>
          {data.founders?.length > 0 && (
            <div className="mb-3">
              <div className="text-[9px] font-mono text-ink-700 mb-1.5">Founders</div>
              <div className="flex flex-wrap gap-2">
                {data.founders.map((f: string) => (
                  <Link key={f} href={`/?q=${encodeURIComponent(f)}&searchMode=person`}
                    className="text-xs px-2.5 py-1 border border-white/10 text-ink-300 hover:text-ink-50 hover:border-white/30 transition-colors">
                    {f}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {data.teamMembers?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono text-ink-700 mb-1.5">Team</div>
              <div className="flex flex-wrap gap-2">
                {data.teamMembers.map((m: string) => (
                  <span key={m} className="text-xs px-2.5 py-1 border border-white/5 text-ink-500">{m}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Funding */}
      {(data.fundingMentions?.length > 0 || data.investors?.length > 0) && (
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3 flex items-center gap-1">
            <DollarSign size={10} />Funding signals
          </div>
          {data.fundingMentions?.map((m: string, i: number) => (
            <div key={i} className="text-sm text-signal-clean font-medium mb-1">{m}</div>
          ))}
          {data.investors?.length > 0 && (
            <div className="text-[10px] font-mono text-ink-500 mt-2">
              Investors: {data.investors.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* WHOIS + Contact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* WHOIS */}
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3">Domain / WHOIS</div>
          <div className="space-y-2">
            {data.whois?.registrar && <Row label="Registrar" value={data.whois.registrar} />}
            {data.whois?.registrant && <Row label="Registrant" value={data.whois.registrant} />}
            {data.whois?.country && <Row label="Country" value={data.whois.country} />}
            {data.whois?.createdDate && <Row label="Registered" value={new Date(data.whois.createdDate).toLocaleDateString('en-GB')} />}
            {data.whois?.expiresDate && <Row label="Expires" value={new Date(data.whois.expiresDate).toLocaleDateString('en-GB')} />}
          </div>
        </div>

        {/* Contact & Social */}
        <div className="border border-white/5 bg-ink-850 p-5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-ink-600 mb-3">Contact & Social</div>
          <div className="space-y-2">
            {data.email && (
              <div className="flex items-center gap-2 text-xs text-ink-300">
                <Mail size={10} className="text-ink-600 shrink-0" />
                <a href={`mailto:${data.email}`} className="hover:text-ink-50 transition-colors truncate">{data.email}</a>
              </div>
            )}
            {data.linkedinUrl && (
              <div className="flex items-center gap-2 text-xs text-ink-300">
                <Link2 size={10} className="text-ink-600 shrink-0" />
                <a href={data.linkedinUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors truncate">{data.linkedinUrl.replace('https://www.linkedin.com/', '')}</a>
              </div>
            )}
            {data.twitterUrl && (
              <div className="flex items-center gap-2 text-xs text-ink-300">
                <Link2 size={10} className="text-ink-600 shrink-0" />
                <a href={data.twitterUrl} target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors truncate">{data.twitterUrl.replace('https://twitter.com/', '@')}</a>
              </div>
            )}
            {!data.email && !data.linkedinUrl && !data.twitterUrl && (
              <div className="text-[10px] font-mono text-ink-700">No contact info found</div>
            )}
          </div>
        </div>
      </div>

      {/* Sources */}
      <div className="text-[9px] font-mono text-ink-700 pb-4">
        Sources: {data.sources?.join(' · ') || 'None'}
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-ink-850 p-4">
      <div className="flex items-center gap-1.5 text-ink-600 mb-1">{icon}<span className="text-[9px] font-mono uppercase tracking-wider">{label}</span></div>
      <div className="text-sm font-medium text-ink-200">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[10px] font-mono text-ink-600">{label}</span>
      <span className="text-xs text-ink-300 text-right truncate max-w-[160px]">{value}</span>
    </div>
  );
}

export default function DomainResearchPage() {
  return (
    <main className="min-h-screen">
      <NavBar />
      <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-6 h-6 border-2 border-ink-700 border-t-[#d4ff00] rounded-full animate-spin" /></div>}>
        <DomainResearchContent />
      </Suspense>
    </main>
  );
}
