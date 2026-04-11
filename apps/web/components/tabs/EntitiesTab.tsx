'use client';
import { useMemo, useState } from 'react';
import { Avatar } from '../Avatar';
import { Insights } from '../Insights';
import { Dropdown } from '../Dropdown';
import { EmptyState, EntityDetailPanel, ProximityDot } from './shared';

interface Props {
  entities?: { company: any[]; person: any[]; address: any[] };
  investigationId: string;
}

type EntityType = 'company' | 'person' | 'address';
type RiskKey = 'matched' | 'high-shell' | 'nominee' | 'virtual-office';
const ALL_RISKS: RiskKey[] = ['matched', 'high-shell', 'nominee', 'virtual-office'];

export function EntitiesTab({ entities, investigationId }: Props) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | EntityType>('all');
  const [riskFilter, setRiskFilter] = useState<Set<RiskKey>>(new Set());
  const [classFilter, setClassFilter] = useState<{ type: EntityType; key: string } | null>(null);
  const [sortBy, setSortBy] = useState<'risk' | 'name' | 'degree' | 'classification'>('risk');
  const [selected, setSelected] = useState<{ type: string; entity: any } | null>(null);

  function toggleRisk(r: RiskKey) {
    const next = new Set(riskFilter);
    if (next.has(r)) next.delete(r);
    else next.add(r);
    setRiskFilter(next);
  }
  function toggleClass(type: EntityType, key: string) {
    if (classFilter && classFilter.type === type && classFilter.key === key) setClassFilter(null);
    else setClassFilter({ type, key });
  }

  if (!entities) return <EmptyState message="No entities found." />;

  // ----- BRIEF BOX STATS -----
  const stats = useMemo(() => {
    const companies = entities.company || [];
    const people = entities.person || [];
    const addresses = entities.address || [];

    const companyProfiles: Record<string, number> = {};
    for (const c of companies) {
      const p = c.metadata?.companyProfile || 'UNKNOWN';
      companyProfiles[p] = (companyProfiles[p] || 0) + 1;
    }
    const directorProfiles: Record<string, number> = {};
    for (const p of people) {
      const r = p.metadata?.directorProfile?.risk || 'NORMAL';
      directorProfiles[r] = (directorProfiles[r] || 0) + 1;
    }
    const addressClasses: Record<string, number> = {};
    for (const a of addresses) {
      const c = a.metadata?.addressAnalysis?.classification || 'NORMAL';
      addressClasses[c] = (addressClasses[c] || 0) + 1;
    }
    const jurisdictions: Record<string, number> = {};
    for (const c of companies) {
      const j = c.metadata?.jurisdiction;
      if (j) jurisdictions[j] = (jurisdictions[j] || 0) + 1;
    }
    const topJurisdiction = Object.entries(jurisdictions).sort((a, b) => b[1] - a[1])[0];

    return {
      companies: companies.length,
      people: people.length,
      addresses: addresses.length,
      companyProfiles,
      directorProfiles,
      addressClasses,
      topJurisdiction,
      jurisdictionCount: Object.keys(jurisdictions).length,
    };
  }, [entities]);

  // ----- FLATTEN + FILTER + SORT -----
  const allEntities = useMemo(() => {
    const all: Array<{ type: EntityType; entity: any }> = [];
    for (const c of entities.company || []) all.push({ type: 'company', entity: c });
    for (const p of entities.person || []) all.push({ type: 'person', entity: p });
    for (const a of entities.address || []) all.push({ type: 'address', entity: a });
    return all;
  }, [entities]);

  const filtered = useMemo(() => {
    let result = allEntities;
    if (typeFilter !== 'all') result = result.filter((e) => e.type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) =>
        e.entity.label?.toLowerCase().includes(q) ||
        e.entity.entityId?.toLowerCase().includes(q),
      );
    }
    if (riskFilter.size > 0) {
      const matchesRisk = (entity: any): boolean => {
        for (const r of riskFilter) {
          if (r === 'matched' && (entity.matches?.length || 0) > 0) return true;
          if (r === 'high-shell' && (entity.metadata?.shellCompanyScore?.risk === 'HIGH' || entity.metadata?.shellCompanyScore?.risk === 'CRITICAL')) return true;
          if (r === 'nominee' && (entity.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN' || entity.metadata?.directorProfile?.risk === 'FORMATION_AGENT')) return true;
          if (r === 'virtual-office' && (entity.metadata?.addressAnalysis?.classification === 'VIRTUAL_OFFICE' || entity.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT')) return true;
        }
        return false;
      };
      result = result.filter(({ entity }) => matchesRisk(entity));
    }
    if (classFilter) {
      result = result.filter(({ type, entity }) => type === classFilter.type && classificationOf(entity, type) === classFilter.key);
    }
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return (a.entity.label || '').localeCompare(b.entity.label || '');
      if (sortBy === 'degree') return (b.entity.degree || 0) - (a.entity.degree || 0);
      if (sortBy === 'classification') {
        const ac = classificationOf(a.entity, a.type) || '';
        const bc = classificationOf(b.entity, b.type) || '';
        return ac.localeCompare(bc);
      }
      // risk: matches first, then high shell/nominee/VO, then by degree
      const riskA = riskScore(a.entity, a.type);
      const riskB = riskScore(b.entity, b.type);
      if (riskB !== riskA) return riskB - riskA;
      return (b.entity.degree || 0) - (a.entity.degree || 0);
    });
    return result;
  }, [allEntities, typeFilter, search, riskFilter, classFilter, sortBy]);

  const visible = filtered.slice(0, 200);
  const hasFilters = search || typeFilter !== 'all' || riskFilter.size > 0 || classFilter;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className={selected ? 'lg:col-span-2 space-y-10' : 'lg:col-span-3 space-y-10'}>
        {/* A. Brief box */}
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Network composition</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
            <BriefCard
              label="Companies"
              type="company"
              count={stats.companies}
              breakdown={stats.companyProfiles}
              activeKey={classFilter?.type === 'company' ? classFilter.key : null}
              onPick={(k) => toggleClass('company', k)}
            />
            <BriefCard
              label="People"
              type="person"
              count={stats.people}
              breakdown={stats.directorProfiles}
              highlightKeys={['NOMINEE_PATTERN', 'FORMATION_AGENT']}
              activeKey={classFilter?.type === 'person' ? classFilter.key : null}
              onPick={(k) => toggleClass('person', k)}
            />
            <BriefCard
              label="Addresses"
              type="address"
              count={stats.addresses}
              breakdown={stats.addressClasses}
              highlightKeys={['VIRTUAL_OFFICE', 'FORMATION_AGENT']}
              activeKey={classFilter?.type === 'address' ? classFilter.key : null}
              onPick={(k) => toggleClass('address', k)}
            />
          </div>
          {(stats.topJurisdiction || stats.jurisdictionCount > 0) && (
            <div className="mt-3 text-[10px] font-mono text-ink-500">
              {stats.topJurisdiction && (
                <>top jurisdiction: <span className="text-ink-300">{stats.topJurisdiction[0]}</span> ({stats.topJurisdiction[1]} companies)</>
              )}
              {stats.jurisdictionCount > 1 && (
                <span className="ml-3">· spread across {stats.jurisdictionCount} jurisdictions</span>
              )}
            </div>
          )}
        </section>

        {/* B. AI insights */}
        <Insights investigationId={investigationId} topic="entities" />

        {/* C. Filter bar */}
        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Filter & search</div>
          <div className="space-y-3">
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Search by name or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 px-4 py-3 bg-ink-850 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30 transition-colors"
              />
              <Dropdown
                value={sortBy}
                onChange={(v) => setSortBy(v as any)}
                options={[
                  { value: 'risk', label: 'Sort: risk' },
                  { value: 'name', label: 'Sort: name' },
                  { value: 'degree', label: 'Sort: connections' },
                  { value: 'classification', label: 'Sort: classification' },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2">type</span>
              {(['all', 'company', 'person', 'address'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                    typeFilter === t
                      ? 'bg-white/10 text-ink-50 border-white/30'
                      : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                  }`}
                >
                  {t}
                </button>
              ))}
              <span className="text-[10px] font-mono text-ink-500 uppercase tracking-wider mr-2 ml-4">risk</span>
              {ALL_RISKS.map((r) => (
                <button
                  key={r}
                  onClick={() => toggleRisk(r)}
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                    riskFilter.has(r)
                      ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/40'
                      : 'bg-ink-850 text-ink-400 border-white/10 hover:border-white/30'
                  }`}
                >
                  {r}
                </button>
              ))}
              {classFilter && (
                <span className="text-[10px] font-mono px-2 py-1 rounded-sm border border-white/30 bg-white/10 text-ink-50">
                  {classFilter.type}: {titleCase(classFilter.key)}
                  <button onClick={() => setClassFilter(null)} className="ml-1 text-ink-400 hover:text-ink-50">×</button>
                </span>
              )}
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setTypeFilter('all'); setRiskFilter(new Set()); setClassFilter(null); }}
                  className="ml-auto text-[10px] font-mono text-ink-400 hover:text-ink-50 transition-colors"
                >
                  clear filters →
                </button>
              )}
            </div>
          </div>
        </section>

        {/* D. Unified entity table */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">
              / Entities ({filtered.length}{filtered.length !== allEntities.length ? ` of ${allEntities.length}` : ''})
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No entities match the current filters." />
          ) : (
            <div className="border border-white/5">
              <div className="grid grid-cols-12 gap-3 px-3 py-3 border-b border-white/5 bg-ink-900 text-[10px] font-mono uppercase tracking-wider text-ink-500">
                <div className="col-span-1">Type</div>
                <div className="col-span-5">Name</div>
                <div className="col-span-3">Classification</div>
                <div className="col-span-1 text-right">Risk</div>
                <div className="col-span-1 text-right">Conn</div>
                <div className="col-span-1 text-right">Match</div>
              </div>
              {visible.map(({ type, entity }) => {
                const cls = classificationOf(entity, type);
                const risky = riskScore(entity, type) > 0;
                return (
                  <button
                    key={entity.id}
                    onClick={() => setSelected({ type, entity })}
                    className={`w-full grid grid-cols-12 gap-3 px-3 py-3 items-center text-left transition-colors border-b border-white/5 last:border-b-0 ${
                      selected?.entity?.id === entity.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="col-span-1">
                      <Avatar name={entity.label} type={type} size={28} />
                    </div>
                    <div className="col-span-5 min-w-0 flex items-center gap-2">
                      <ProximityDot score={entity.proximityScore} />
                      <span className="truncate text-sm text-ink-50">{entity.label}</span>
                    </div>
                    <div className="col-span-3 min-w-0">
                      {cls ? (
                        <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border truncate inline-block max-w-full ${classColor(cls, type)}`}>
                          {cls}
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono text-ink-600">·</span>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      {risky && <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-critical" />}
                    </div>
                    <div className="col-span-1 text-right text-xs font-mono text-ink-400">
                      {entity.degree || 0}
                    </div>
                    <div className="col-span-1 text-right">
                      {entity.matches?.length > 0 && (
                        <span className="text-[9px] font-mono px-1 py-0.5 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                          {entity.matches.length}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {filtered.length > visible.length && (
            <div className="mt-3 text-[10px] font-mono text-ink-500 text-center">
              showing first {visible.length} of {filtered.length} · refine filters to narrow further
            </div>
          )}
        </section>
      </div>

      {selected && (
        <aside className="lg:col-span-1 sticky top-32 h-fit">
          <EntityDetailPanel entity={selected.entity} type={selected.type} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}

function BriefCard({
  label,
  type,
  count,
  breakdown,
  highlightKeys = [],
  activeKey,
  onPick,
}: {
  label: string;
  type: EntityType;
  count: number;
  breakdown: Record<string, number>;
  highlightKeys?: string[];
  activeKey?: string | null;
  onPick?: (key: string) => void;
}) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <div className="bg-ink-850 p-6">
      <div className="text-3xl font-medium text-ink-50 tabular-nums">{count}</div>
      <div className="text-[10px] uppercase tracking-[0.15em] text-ink-500 mt-1 font-mono mb-3">{label}</div>
      {entries.length > 0 && (
        <ul className="space-y-0.5">
          {entries.map(([key, val]) => {
            const highlight = highlightKeys.includes(key);
            const active = activeKey === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onPick?.(key)}
                  className={`w-full flex items-center justify-between text-[10px] font-mono px-1.5 py-1 -mx-1.5 rounded-sm transition-colors ${
                    active ? 'bg-white/10' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <span className={highlight ? 'text-signal-critical' : active ? 'text-ink-50' : 'text-ink-400'}>
                    {titleCase(key)}
                  </span>
                  <span className={`tabular-nums ${highlight ? 'text-signal-critical' : active ? 'text-ink-50' : 'text-ink-300'}`}>{val}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function titleCase(s: string): string {
  if (!s) return '';
  const initialisms = new Set(['PLC', 'LLP', 'LTD', 'LLC', 'UK', 'USA', 'PSC', 'CIC', 'SE', 'EU', 'GB', 'NI', 'HQ']);
  return s
    .replace(/_/g, ' ')
    .split(/(\s|-)/)
    .map((part) => {
      if (part === ' ' || part === '-') return part;
      const u = part.toUpperCase();
      if (initialisms.has(u)) return u;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('');
}

function classificationOf(entity: any, type: string): string | undefined {
  if (type === 'company') return entity.metadata?.companyProfile;
  if (type === 'person') return entity.metadata?.directorProfile?.risk;
  if (type === 'address') return entity.metadata?.addressAnalysis?.classification;
}

function riskScore(entity: any, type: string): number {
  let score = 0;
  if ((entity.matches?.length || 0) > 0) score += 100;
  if (entity.proximityScore === 'CRITICAL') score += 60;
  else if (entity.proximityScore === 'HIGH') score += 40;
  else if (entity.proximityScore === 'MEDIUM') score += 20;
  if (type === 'company') {
    const r = entity.metadata?.shellCompanyScore?.risk;
    if (r === 'CRITICAL') score += 50;
    else if (r === 'HIGH') score += 30;
    else if (r === 'MEDIUM') score += 10;
  }
  if (type === 'person') {
    const r = entity.metadata?.directorProfile?.risk;
    if (r === 'FORMATION_AGENT') score += 50;
    else if (r === 'NOMINEE_PATTERN') score += 30;
  }
  if (type === 'address') {
    const c = entity.metadata?.addressAnalysis?.classification;
    if (c === 'FORMATION_AGENT') score += 40;
    else if (c === 'VIRTUAL_OFFICE') score += 30;
  }
  return score;
}

function classColor(cls: string, type: string): string {
  if (type === 'company') {
    if (cls === 'LARGE_PUBLIC' || cls === 'ESTABLISHED_PRIVATE') return 'bg-signal-clean/10 text-signal-clean border-signal-clean/30';
    if (cls === 'MICRO_ENTITY' || cls === 'NEWLY_FORMED') return 'bg-signal-medium/10 text-signal-medium border-signal-medium/30';
    if (cls === 'DISSOLVED') return 'bg-white/5 text-ink-400 border-white/10';
    return 'bg-white/5 text-ink-300 border-white/10';
  }
  if (type === 'person') {
    if (cls === 'FORMATION_AGENT' || cls === 'NOMINEE_PATTERN') return 'bg-signal-critical/10 text-signal-critical border-signal-critical/30';
    if (cls === 'PROFESSIONAL_DIRECTOR') return 'bg-signal-clean/10 text-signal-clean border-signal-clean/30';
    return 'bg-white/5 text-ink-300 border-white/10';
  }
  if (type === 'address') {
    if (cls === 'FORMATION_AGENT' || cls === 'VIRTUAL_OFFICE') return 'bg-signal-critical/10 text-signal-critical border-signal-critical/30';
    if (cls === 'BUSINESS_CENTER' || cls === 'CORPORATE_HQ') return 'bg-signal-clean/10 text-signal-clean border-signal-clean/30';
    return 'bg-white/5 text-ink-300 border-white/10';
  }
  return 'bg-white/5 text-ink-300 border-white/10';
}
