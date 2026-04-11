'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Shield, Users, AlertTriangle, Globe, Building2, MapPin } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Dropdown } from '../Dropdown';
import { EmptyState, EntityDetailPanel, ProximityDot } from './shared';

interface Props {
  entities?: { company: any[]; person: any[]; address: any[] };
  investigationId: string;
}

// --- SIC code lookup (common codes) ---
const SIC_LABELS: Record<string, string> = {
  '47190': 'Retail sale in non-specialised stores',
  '62020': 'IT consultancy activities',
  '70229': 'Management consultancy activities',
  '68209': 'Letting/operating of own property',
  '64209': 'Other financial service activities',
  '82990': 'Other business support service activities',
  '46900': 'Non-specialised wholesale trade',
  '74990': 'Other professional activities',
  '96090': 'Other personal service activities',
  '41100': 'Development of building projects',
  '68100': 'Buying and selling of own real estate',
  '43999': 'Other construction activities',
  '56101': 'Licensed restaurants',
  '01110': 'Growing of cereals and other crops',
};

function sicLabel(code: string): string {
  return SIC_LABELS[code] || `SIC ${code}`;
}

export function EntitiesTab({ entities, investigationId }: Props) {
  const [selected, setSelected] = useState<{ type: string; entity: any } | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);

  if (!entities) return <EmptyState message="No entities found." />;

  const companies = entities.company || [];
  const people = entities.person || [];
  const addresses = entities.address || [];

  // Find target company
  const targetCompany = companies.find((c) => c.relationToTarget === 'Target');

  // Leadership: direct directors + PSCs
  const leadership = people.filter((p) => p.relationToTarget === 'Director' || p.relationToTarget === 'PSC/Owner');
  const pscs = leadership.filter((p) => p.relationToTarget === 'PSC/Owner');
  const directors = leadership.filter((p) => p.relationToTarget === 'Director');
  // Sort: PSCs first, then directors
  const sortedLeadership = [...pscs, ...directors];

  // Target address
  const targetAddress = addresses.find((a) => a.relationToTarget === 'Address');

  // Key network entities - only the flagged/interesting ones
  const flaggedCompanies = companies.filter((c) =>
    c.relationToTarget !== 'Target' &&
    (c.metadata?.shellCompanyScore?.risk === 'HIGH' || c.metadata?.shellCompanyScore?.risk === 'CRITICAL'),
  );
  const flaggedPeople = people.filter((p) =>
    p.relationToTarget !== 'Director' && p.relationToTarget !== 'PSC/Owner' &&
    (p.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN' || p.metadata?.directorProfile?.risk === 'FORMATION_AGENT'),
  );
  const flaggedAddresses = addresses.filter((a) =>
    a.relationToTarget !== 'Address' &&
    (a.metadata?.addressAnalysis?.classification === 'VIRTUAL_OFFICE' || a.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT'),
  );
  const matchedEntities = [...companies, ...people, ...addresses].filter((e) => (e.matches?.length || 0) > 0);

  const totalFlagged = flaggedCompanies.length + flaggedPeople.length + flaggedAddresses.length + matchedEntities.length;

  // Brief stats
  const shellCount = companies.filter((c) => c.metadata?.shellCompanyScore?.risk === 'HIGH' || c.metadata?.shellCompanyScore?.risk === 'CRITICAL').length;
  const nomineeCount = people.filter((p) => p.metadata?.directorProfile?.risk === 'NOMINEE_PATTERN' || p.metadata?.directorProfile?.risk === 'FORMATION_AGENT').length;
  const voCount = addresses.filter((a) => a.metadata?.addressAnalysis?.classification === 'VIRTUAL_OFFICE' || a.metadata?.addressAnalysis?.classification === 'FORMATION_AGENT').length;
  const highDensityCount = addresses.filter((a) => (a.metadata?.addressAnalysis?.density || 0) > 10).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:items-start">
      <div className={selected ? 'lg:col-span-2 space-y-6' : 'lg:col-span-3 space-y-6'}>
        {/* Brief stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/5 border border-white/5">
          <div className="bg-ink-850 p-5">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{companies.length.toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono">Companies</div>
            <div className="text-[10px] text-ink-400 mt-2">
              {shellCount > 0 ? <span className="text-signal-critical">{shellCount} shell risk</span> : <span className="text-ink-500">no shell risk flagged</span>}
            </div>
          </div>
          <div className="bg-ink-850 p-5">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{people.length.toLocaleString()}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono">People</div>
            <div className="text-[10px] text-ink-400 mt-2">
              <span className="text-ink-300">{leadership.length}</span> direct (directors/PSCs)
              {nomineeCount > 0 && <span className="text-signal-critical"> · {nomineeCount} flagged</span>}
            </div>
          </div>
          <div className="bg-ink-850 p-5">
            <div className="text-2xl font-medium text-ink-50 tabular-nums">{addresses.length}</div>
            <div className="text-[9px] uppercase tracking-[0.15em] text-ink-500 mt-0.5 font-mono">Addresses</div>
            <div className="text-[10px] text-ink-400 mt-2">
              {voCount > 0 ? <span className="text-signal-critical">{voCount} virtual office</span> : null}
              {highDensityCount > 0 ? <span>{voCount > 0 ? ' · ' : ''}{highDensityCount} high density</span> : null}
              {voCount === 0 && highDensityCount === 0 && <span className="text-ink-500">no flags</span>}
            </div>
          </div>
        </div>

        {/* SECTION A: The Company */}
        {targetCompany && (
          <section className="border border-white/5 border-l-2 border-l-signal-clean">
            <div className="px-5 py-4 flex items-center gap-3">
              <Building2 size={14} className="text-ink-500" />
              <div className="text-sm text-ink-50 font-medium">The Company</div>
            </div>
            <div className="border-t border-white/5 px-5 py-5">
              <CompanyCard company={targetCompany} address={targetAddress} onSelect={(c) => setSelected({ type: 'company', entity: c })} />
            </div>
          </section>
        )}

        {/* SECTION B: Leadership */}
        <section className="border border-white/5 border-l-2 border-l-ink-500">
          <div className="px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users size={14} className="text-ink-500" />
              <div>
                <div className="text-sm text-ink-50 font-medium">Leadership</div>
                <div className="text-[10px] font-mono text-ink-500 mt-0.5">{pscs.length} PSC{pscs.length !== 1 ? 's' : ''} · {directors.length} director{directors.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </div>
          <div className="border-t border-white/5">
            {sortedLeadership.length === 0 ? (
              <div className="px-5 py-8 text-sm text-ink-500 font-mono text-center">No direct directors or PSCs found</div>
            ) : (
              <div className="divide-y divide-white/5">
                {sortedLeadership.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    targetName={targetCompany?.label}
                    isSelected={selected?.entity?.id === person.id}
                    onSelect={() => setSelected({ type: 'person', entity: person })}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SECTION C: Key Network Entities */}
        <section className={`border border-white/5 border-l-2 ${totalFlagged > 0 ? 'border-l-signal-critical' : 'border-l-signal-clean'}`}>
          <div className="px-5 py-4 flex items-center gap-3">
            <AlertTriangle size={14} className="text-ink-500" />
            <div>
              <div className="text-sm text-ink-50 font-medium">Key Network Entities</div>
              <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                {totalFlagged > 0 ? `${totalFlagged} flagged entities in the wider network` : 'No notable risk entities found'}
              </div>
            </div>
          </div>
          <div className="border-t border-white/5">
            {totalFlagged === 0 ? (
              <div className="px-5 py-6 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-signal-clean" />
                <span className="text-sm text-ink-300">No notable risk entities found in the network.</span>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {flaggedCompanies.length > 0 && (
                  <FlaggedGroup
                    title="Flagged companies"
                    subtitle={`${flaggedCompanies.length} with shell risk HIGH+`}
                    items={flaggedCompanies.slice(0, 10)}
                    type="company"
                    onSelect={(e) => setSelected({ type: 'company', entity: e })}
                    selectedId={selected?.entity?.id}
                    renderBadge={(e) => (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                        SHELL {e.metadata?.shellCompanyScore?.risk}
                      </span>
                    )}
                  />
                )}
                {flaggedPeople.length > 0 && (
                  <FlaggedGroup
                    title="Flagged directors"
                    subtitle={`${flaggedPeople.length} with nominee/formation patterns`}
                    items={flaggedPeople.slice(0, 10)}
                    type="person"
                    onSelect={(e) => setSelected({ type: 'person', entity: e })}
                    selectedId={selected?.entity?.id}
                    renderBadge={(e) => (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                        {e.metadata?.directorProfile?.risk?.replace('_', ' ')}
                      </span>
                    )}
                  />
                )}
                {flaggedAddresses.length > 0 && (
                  <FlaggedGroup
                    title="Suspicious addresses"
                    subtitle={`${flaggedAddresses.length} virtual offices or formation agent addresses`}
                    items={flaggedAddresses.slice(0, 10)}
                    type="address"
                    onSelect={(e) => setSelected({ type: 'address', entity: e })}
                    selectedId={selected?.entity?.id}
                    renderBadge={(e) => (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                        {e.metadata?.addressAnalysis?.classification?.replace('_', ' ')}
                      </span>
                    )}
                  />
                )}
                {matchedEntities.length > 0 && (
                  <FlaggedGroup
                    title="Sanctions matches"
                    subtitle={`${matchedEntities.length} entities matching sanctions/ICIJ`}
                    items={matchedEntities.slice(0, 10)}
                    type="company"
                    onSelect={(e) => setSelected({ type: e.entityType || 'company', entity: e })}
                    selectedId={selected?.entity?.id}
                    renderBadge={(e) => (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical text-ink-900">
                        {e.matches?.length} match{e.matches?.length > 1 ? 'es' : ''}
                      </span>
                    )}
                  />
                )}
              </div>
            )}
          </div>
        </section>

        {/* SECTION D: Full Network Explorer */}
        <section className="border border-white/5">
          <button
            onClick={() => setExplorerOpen(!explorerOpen)}
            className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
          >
            <div className="flex items-center gap-3">
              <Globe size={14} className="text-ink-500" />
              <div className="text-left">
                <div className="text-sm text-ink-50 font-medium">Full Network Explorer</div>
                <div className="text-[10px] font-mono text-ink-500 mt-0.5">
                  {companies.length.toLocaleString()} companies · {people.length.toLocaleString()} people · {addresses.length} addresses
                </div>
              </div>
            </div>
            {explorerOpen ? <ChevronDown size={14} className="text-ink-500" /> : <ChevronRight size={14} className="text-ink-500" />}
          </button>
          {explorerOpen && (
            <div className="border-t border-white/5">
              <NetworkExplorer
                entities={entities}
                selected={selected}
                onSelect={setSelected}
              />
            </div>
          )}
        </section>
      </div>

      {/* Detail panel */}
      {selected && (
        <aside className="lg:col-span-1 sticky top-32 h-fit">
          <EnhancedDetailPanel
            entity={selected.entity}
            type={selected.type}
            targetName={targetCompany?.label}
            onClose={() => setSelected(null)}
          />
        </aside>
      )}
    </div>
  );
}

// --- Company Card (Section A) ---
function CompanyCard({ company, address, onSelect }: { company: any; address?: any; onSelect: (c: any) => void }) {
  const meta = company.metadata || {};
  const age = meta.incorporationDate ? Math.floor((Date.now() - new Date(meta.incorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  const sics = (meta.sicCodes || []).map((s: string) => sicLabel(s)).join(', ');

  // Build plain English summary
  const parts: string[] = [];
  parts.push(`${meta.status === 'active' ? 'Active' : meta.status || 'Unknown'} ${meta.companyType || 'company'}`);
  if (age !== null) parts.push(`${age} years old`);
  if (meta.accountsType) parts.push(`files ${meta.accountsType} accounts`);

  return (
    <button onClick={() => onSelect(company)} className="w-full text-left hover:bg-white/[0.02] transition-colors -m-2 p-2 rounded-sm">
      <div className="flex items-start gap-4">
        <Avatar name={company.label} type="company" size={48} />
        <div className="flex-1 min-w-0">
          <div className="text-base text-ink-50 font-medium">{company.label}</div>
          <div className="text-[10px] font-mono text-ink-500 mt-0.5">{company.entityId} · {parts.join(', ')}</div>
          {sics && <div className="text-xs text-ink-400 mt-1">{sics}</div>}

          {/* Badges row */}
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge label="Filing" value={meta.filingHealth?.band || 'N/A'} good={meta.filingHealth?.band === 'GOOD'} bad={meta.filingHealth?.band === 'POOR'} />
            <Badge label="Shell risk" value={meta.shellCompanyScore?.risk || 'N/A'} good={meta.shellCompanyScore?.risk === 'LOW'} bad={meta.shellCompanyScore?.risk === 'HIGH' || meta.shellCompanyScore?.risk === 'CRITICAL'} />
            <Badge label="Ownership" value={meta.ownershipOpacity?.band || 'N/A'} good={meta.ownershipOpacity?.band === 'TRANSPARENT'} bad={meta.ownershipOpacity?.band === 'OPAQUE'} />
          </div>

          {/* Address line */}
          {address && (
            <div className="flex items-center gap-2 mt-3 text-[10px] text-ink-400">
              <MapPin size={10} className="text-ink-500 shrink-0" />
              <span className="truncate">{address.label}</span>
              {address.metadata?.addressAnalysis?.classification && (
                <span className="text-[9px] font-mono text-ink-500 shrink-0">({address.metadata.addressAnalysis.classification.replace(/_/g, ' ').toLowerCase()})</span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// --- Person Card (Section B) ---
function PersonCard({ person, targetName, isSelected, onSelect }: {
  person: any; targetName?: string; isSelected: boolean; onSelect: () => void;
}) {
  const meta = person.metadata || {};
  const dp = meta.directorProfile || {};
  const dv = meta.directorVelocity || {};
  const role = person.relationToTarget === 'PSC/Owner' ? 'PSC' : 'Director';
  const dissolved = dp.dissolved || 0;
  const active = dp.active || 0;
  const total = dp.totalAppointments || 0;

  // Track record color
  const trackGood = dissolved === 0 || (dissolved / total) < 0.3;
  const riskBad = dp.risk === 'NOMINEE_PATTERN' || dp.risk === 'FORMATION_AGENT';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-5 py-4 transition-colors ${isSelected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
    >
      <div className="flex items-start gap-4">
        <Avatar name={person.label} type="person" size={36} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-50 font-medium">{person.label}</span>
            <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
              role === 'PSC' ? 'bg-signal-high/10 text-signal-high border-signal-high/30' : 'bg-white/5 text-ink-300 border-white/10'
            }`}>{role}</span>
            {riskBad && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                {dp.risk?.replace('_', ' ')}
              </span>
            )}
            {(person.matches?.length || 0) > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-critical text-ink-900">
                SANCTIONS MATCH
              </span>
            )}
          </div>
          <div className="text-[10px] text-ink-400 mt-1">
            {meta.nationality && <span>{meta.nationality}</span>}
            {meta.nationality && total > 0 && <span> · </span>}
            {total > 0 && (
              <span className={trackGood ? 'text-ink-400' : 'text-signal-critical'}>
                {active} active, {dissolved} dissolved ({total} total)
              </span>
            )}
          </div>
          {dv.flagged && dv.reasons?.length > 0 && (
            <div className="text-[10px] text-signal-medium mt-1">
              {dv.reasons[0]}
            </div>
          )}
        </div>
        <div className="text-[10px] font-mono text-ink-600 tabular-nums shrink-0">{person.degree} conn</div>
      </div>
    </button>
  );
}

// --- Flagged Group (Section C) ---
function FlaggedGroup({ title, subtitle, items, type, onSelect, selectedId, renderBadge }: {
  title: string; subtitle: string; items: any[]; type: string;
  onSelect: (e: any) => void; selectedId?: string;
  renderBadge: (e: any) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(items.length <= 5);

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-ink-50 font-medium">{title}</div>
          <div className="text-[10px] font-mono text-ink-500">{subtitle}</div>
        </div>
        {items.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] font-mono text-ink-400 hover:text-ink-50">
            {expanded ? 'collapse' : `show all ${items.length}`}
          </button>
        )}
      </div>
      <div className="space-y-1">
        {(expanded ? items : items.slice(0, 5)).map((entity) => (
          <button
            key={entity.id}
            onClick={() => onSelect(entity)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-sm text-left transition-colors ${
              selectedId === entity.id ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
            }`}
          >
            <Avatar name={entity.label} type={type as any} size={24} />
            <span className="text-xs text-ink-300 truncate flex-1">{entity.label}</span>
            <span className="text-[9px] font-mono text-ink-600 shrink-0">{entity.relationToTarget}</span>
            {renderBadge(entity)}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Network Explorer (Section D) ---
function NetworkExplorer({ entities, selected, onSelect }: {
  entities: { company: any[]; person: any[]; address: any[] };
  selected: { type: string; entity: any } | null;
  onSelect: (sel: { type: string; entity: any } | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'company' | 'person' | 'address'>('all');
  const [sortBy, setSortBy] = useState<'risk' | 'name' | 'degree'>('risk');

  const allEntities = useMemo(() => {
    const all: Array<{ type: string; entity: any }> = [];
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
      result = result.filter((e) => e.entity.label?.toLowerCase().includes(q) || e.entity.entityId?.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      if (sortBy === 'name') return (a.entity.label || '').localeCompare(b.entity.label || '');
      if (sortBy === 'degree') return (b.entity.degree || 0) - (a.entity.degree || 0);
      return riskScore(b.entity, b.type) - riskScore(a.entity, a.type);
    });
    return result;
  }, [allEntities, typeFilter, search, sortBy]);

  const visible = filtered.slice(0, 100);
  const REL_COLORS: Record<string, string> = {
    Target: 'bg-signal-clean/15 text-signal-clean border-signal-clean/30',
    Director: 'bg-signal-high/15 text-signal-high border-signal-high/30',
    'PSC/Owner': 'bg-signal-high/15 text-signal-high border-signal-high/30',
    Address: 'bg-white/10 text-ink-300 border-white/15',
    Direct: 'bg-white/10 text-ink-300 border-white/15',
    "Director's company": 'bg-white/5 text-ink-400 border-white/10',
    Network: 'bg-white/5 text-ink-500 border-white/5',
  };

  return (
    <div className="p-4 space-y-4">
      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search all entities..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-ink-900 border border-white/10 rounded-sm text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none focus:border-white/30"
        />
        <Dropdown
          value={sortBy}
          onChange={(v) => setSortBy(v as any)}
          options={[
            { value: 'risk', label: 'Sort: risk' },
            { value: 'name', label: 'Sort: name' },
            { value: 'degree', label: 'Sort: connections' },
          ]}
        />
        <div className="flex items-center gap-1.5">
          {(['all', 'company', 'person', 'address'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${
                typeFilter === t ? 'bg-white/10 text-ink-50 border-white/30' : 'bg-ink-850 text-ink-400 border-white/10'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-white/5">
        <div className="grid grid-cols-12 gap-3 px-3 py-2 border-b border-white/5 bg-ink-900 text-[9px] font-mono uppercase tracking-wider text-ink-500">
          <div className="col-span-1"></div>
          <div className="col-span-4">Name</div>
          <div className="col-span-2">Relation</div>
          <div className="col-span-3">Classification</div>
          <div className="col-span-1 text-right">Conn</div>
          <div className="col-span-1 text-right">Risk</div>
        </div>
        {visible.map(({ type, entity }) => {
          const cls = classificationOf(entity, type);
          return (
            <button
              key={entity.id}
              onClick={() => onSelect({ type, entity })}
              className={`w-full grid grid-cols-12 gap-3 px-3 py-2.5 items-center text-left transition-colors border-b border-white/5 last:border-b-0 ${
                selected?.entity?.id === entity.id ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
              }`}
            >
              <div className="col-span-1"><Avatar name={entity.label} type={type as any} size={24} /></div>
              <div className="col-span-4 min-w-0 flex items-center gap-1.5">
                <ProximityDot score={entity.proximityScore} />
                <span className="truncate text-xs text-ink-50">{entity.label}</span>
              </div>
              <div className="col-span-2">
                <span className={`text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded-sm border ${REL_COLORS[entity.relationToTarget] || REL_COLORS.Network}`}>
                  {entity.relationToTarget || 'Network'}
                </span>
              </div>
              <div className="col-span-3 min-w-0">
                {cls ? (
                  <span className={`text-[8px] font-mono uppercase tracking-wider px-1 py-0.5 rounded-sm border truncate inline-block max-w-full ${classColor(cls, type)}`}>
                    {cls.replace(/_/g, ' ')}
                  </span>
                ) : <span className="text-[10px] font-mono text-ink-600">-</span>}
              </div>
              <div className="col-span-1 text-right text-[10px] font-mono text-ink-400 tabular-nums">{entity.degree || 0}</div>
              <div className="col-span-1 text-right">
                {(entity.matches?.length || 0) > 0 && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-critical" />
                )}
                {riskScore(entity, type) > 20 && (entity.matches?.length || 0) === 0 && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-signal-medium" />
                )}
              </div>
            </button>
          );
        })}
      </div>
      {filtered.length > visible.length && (
        <div className="text-[10px] font-mono text-ink-500 text-center">
          showing {visible.length} of {filtered.length} · refine filters to narrow
        </div>
      )}
    </div>
  );
}

// --- Enhanced Detail Panel ---
function EnhancedDetailPanel({ entity, type, targetName, onClose }: {
  entity: any; type: string; targetName?: string; onClose: () => void;
}) {
  const meta = entity.metadata || {};

  // Build plain English summary
  const summary = buildSummary(entity, type, targetName);

  return (
    <div className="border border-white/5 bg-ink-850 p-5">
      <div className="flex items-start justify-between mb-3">
        <Avatar name={entity.label} type={type as any} size={48} />
        <button onClick={onClose} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">x</button>
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{type}</div>
      <h3 className="font-medium text-ink-50 mt-1 break-words">{entity.label}</h3>

      {/* Summary */}
      {summary && <p className="text-xs text-ink-300 leading-relaxed mt-3 pb-3 border-b border-white/5">{summary}</p>}

      {/* Relationship to target */}
      {entity.relationToTarget && entity.relationToTarget !== 'Network' && targetName && (
        <div className="text-[10px] font-mono text-ink-400 mt-3 pb-3 border-b border-white/5">
          {entity.relationToTarget === 'Target' ? `This is the investigation target` :
           entity.relationToTarget === 'Director' ? `Director of ${targetName}` :
           entity.relationToTarget === 'PSC/Owner' ? `Person with significant control of ${targetName}` :
           entity.relationToTarget === 'Address' ? `Registered address of ${targetName}` :
           entity.relationToTarget === "Director's company" ? `Company directed by a director of ${targetName}` :
           entity.relationToTarget}
        </div>
      )}

      {/* Key metrics */}
      <dl className="mt-3 space-y-2.5 text-sm">
        {type === 'company' && (
          <>
            {meta.status && <DField label="Status" value={meta.status} highlight={meta.status === 'dissolved'} />}
            {meta.companyType && <DField label="Type" value={meta.companyType} />}
            {meta.incorporationDate && <DField label="Incorporated" value={meta.incorporationDate} />}
            {meta.accountsType && <DField label="Accounts" value={meta.accountsType} />}
            {meta.filingHealth && (
              <DField label="Filing health" value={`${meta.filingHealth.band} (${meta.filingHealth.score}/100)`} good={meta.filingHealth.band === 'GOOD'} bad={meta.filingHealth.band === 'POOR'} />
            )}
            {meta.shellCompanyScore && (
              <DField label="Shell risk" value={`${meta.shellCompanyScore.risk} (${meta.shellCompanyScore.score}/100)`} good={meta.shellCompanyScore.risk === 'LOW'} bad={meta.shellCompanyScore.risk === 'HIGH' || meta.shellCompanyScore.risk === 'CRITICAL'} />
            )}
            {meta.ownershipOpacity && (
              <DField label="Ownership" value={`${meta.ownershipOpacity.band} (${meta.ownershipOpacity.score}/100)`} good={meta.ownershipOpacity.band === 'TRANSPARENT'} bad={meta.ownershipOpacity.band === 'OPAQUE'} />
            )}
            {meta.jurisdiction && <DField label="Jurisdiction" value={meta.jurisdiction} />}
          </>
        )}
        {type === 'person' && (
          <>
            {meta.nationality && <DField label="Nationality" value={meta.nationality} />}
            {meta.dateOfBirth?.year && <DField label="Born" value={`${meta.dateOfBirth.month || '?'}/${meta.dateOfBirth.year}`} />}
            {meta.directorProfile && (
              <>
                <DField label="Profile" value={meta.directorProfile.risk?.replace(/_/g, ' ')} bad={meta.directorProfile.risk === 'NOMINEE_PATTERN' || meta.directorProfile.risk === 'FORMATION_AGENT'} />
                <DField label="Appointments" value={`${meta.directorProfile.active} active, ${meta.directorProfile.dissolved} dissolved`} bad={meta.directorProfile.dissolved > 5} />
              </>
            )}
            {meta.directorVelocity?.flagged && (
              <DField label="Velocity" value={meta.directorVelocity.reasons?.[0] || 'Flagged'} bad />
            )}
          </>
        )}
        {type === 'address' && (
          <>
            {meta.addressAnalysis?.classification && (
              <DField label="Classification" value={meta.addressAnalysis.classification.replace(/_/g, ' ')} bad={meta.addressAnalysis.classification === 'VIRTUAL_OFFICE' || meta.addressAnalysis.classification === 'FORMATION_AGENT'} />
            )}
            {meta.companyCount !== undefined && <DField label="Companies here" value={String(meta.companyCount)} bad={meta.companyCount > 10} />}
            {meta.addressAnalysis?.density && <DField label="Density" value={String(meta.addressAnalysis.density)} />}
          </>
        )}
        {entity.degree !== undefined && <DField label="Connections" value={String(entity.degree)} />}
      </dl>

      {/* Risk reasons */}
      {meta.shellCompanyScore?.reasons?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Shell signals</div>
          <ul className="space-y-1">
            {meta.shellCompanyScore.reasons.map((r: string, i: number) => (
              <li key={i} className="text-[10px] text-ink-300 flex gap-2"><span className="text-ink-500">{'>'}</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
      )}

      {meta.ownershipOpacity?.reasons?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Ownership concerns</div>
          <ul className="space-y-1">
            {meta.ownershipOpacity.reasons.map((r: string, i: number) => (
              <li key={i} className="text-[10px] text-ink-300 flex gap-2"><span className="text-ink-500">{'>'}</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
      )}

      {meta.directorProfile?.reasons?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Director signals</div>
          <ul className="space-y-1">
            {meta.directorProfile.reasons.map((r: string, i: number) => (
              <li key={i} className="text-[10px] text-ink-300 flex gap-2"><span className="text-ink-500">{'>'}</span><span>{r}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Matches */}
      {entity.matches?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Sanctions matches</div>
          {entity.matches.map((m: any) => (
            <div key={m.id} className="text-xs border border-white/5 p-2 rounded-sm bg-ink-900 mb-1.5">
              <div className="flex justify-between">
                <span className="text-ink-300">{m.reasons?.matchedName || m.matchedEntityId}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${m.confidence >= 75 ? 'bg-signal-critical text-ink-900' : 'bg-signal-medium text-ink-900'}`}>{m.confidence}%</span>
              </div>
              <div className="text-[10px] font-mono text-ink-500 mt-0.5">{m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Investigate button for companies */}
      {type === 'company' && entity.relationToTarget !== 'Target' && (
        <a href={`/?q=${entity.label}`} className="mt-4 block text-center text-[10px] font-mono uppercase tracking-wider text-ink-400 hover:text-ink-50 border border-white/10 rounded-sm py-2 transition-colors">
          Investigate this company
        </a>
      )}
    </div>
  );
}

// --- Helpers ---

function DField({ label, value, highlight, good, bad }: { label: string; value: string; highlight?: boolean; good?: boolean; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider font-mono">{label}</dt>
      <dd className={`text-xs font-medium text-right ${bad ? 'text-signal-critical' : good ? 'text-signal-clean' : highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</dd>
    </div>
  );
}

function Badge({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <span className={`text-[9px] font-mono px-2 py-1 rounded-sm border ${
      bad ? 'bg-signal-critical/10 text-signal-critical border-signal-critical/30' :
      good ? 'bg-signal-clean/10 text-signal-clean border-signal-clean/30' :
      'bg-white/5 text-ink-300 border-white/10'
    }`}>
      {label}: {value}
    </span>
  );
}

function buildSummary(entity: any, type: string, targetName?: string): string {
  const meta = entity.metadata || {};
  if (type === 'company') {
    const parts: string[] = [];
    const age = meta.incorporationDate ? Math.floor((Date.now() - new Date(meta.incorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
    parts.push(`${meta.status === 'active' ? 'Active' : meta.status || 'Unknown status'} ${meta.companyType || 'company'}`);
    if (age !== null) parts.push(`incorporated ${age} years ago`);
    if (meta.accountsType) parts.push(`files ${meta.accountsType} accounts`);
    if (meta.shellCompanyScore?.risk === 'HIGH' || meta.shellCompanyScore?.risk === 'CRITICAL') parts.push(`shell risk ${meta.shellCompanyScore.risk.toLowerCase()}`);
    if (meta.filingHealth?.band === 'POOR') parts.push(`poor filing discipline`);
    return parts.join(', ') + '.';
  }
  if (type === 'person') {
    const dp = meta.directorProfile || {};
    const parts: string[] = [];
    if (meta.nationality) parts.push(`${meta.nationality} national`);
    if (dp.totalAppointments) parts.push(`${dp.active || 0} active directorships, ${dp.dissolved || 0} dissolved`);
    if (dp.risk && dp.risk !== 'NORMAL') parts.push(`risk profile: ${dp.risk.replace(/_/g, ' ').toLowerCase()}`);
    return parts.join(', ') + '.';
  }
  if (type === 'address') {
    const aa = meta.addressAnalysis || {};
    const parts: string[] = [];
    if (meta.companyCount) parts.push(`hosts ${meta.companyCount} companies`);
    if (aa.classification) parts.push(`classified as ${aa.classification.replace(/_/g, ' ').toLowerCase()}`);
    return parts.join(', ') + '.';
  }
  return '';
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
  if (type === 'company') {
    const r = entity.metadata?.shellCompanyScore?.risk;
    if (r === 'CRITICAL') score += 50;
    else if (r === 'HIGH') score += 30;
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
    return 'bg-white/5 text-ink-300 border-white/10';
  }
  if (type === 'address') {
    if (cls === 'FORMATION_AGENT' || cls === 'VIRTUAL_OFFICE') return 'bg-signal-critical/10 text-signal-critical border-signal-critical/30';
    if (cls === 'BUSINESS_CENTER' || cls === 'CORPORATE_HQ') return 'bg-signal-clean/10 text-signal-clean border-signal-clean/30';
    return 'bg-white/5 text-ink-300 border-white/10';
  }
  return 'bg-white/5 text-ink-300 border-white/10';
}
