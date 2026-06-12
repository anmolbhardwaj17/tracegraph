'use client';
import Link from 'next/link';
import { Avatar } from '../Avatar';
import { AddressMap } from '../AddressMap';

export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7778';

export function ProximityDot({ score }: { score?: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-signal-critical shadow-[0_0_8px_rgba(255,77,77,0.5)]',
    HIGH: 'bg-signal-high',
    MEDIUM: 'bg-signal-medium',
    LOW: 'bg-signal-low',
    CLEAR: 'bg-signal-clean/40',
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${map[score || 'CLEAR']} shrink-0`} />;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="text-center py-16 text-ink-500 text-sm font-mono">{message}</div>;
}

export function DetailField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500 text-[10px] uppercase tracking-wider font-mono">{label}</dt>
      <dd className={`text-xs font-medium text-right ${highlight ? 'text-signal-critical' : 'text-ink-50'}`}>{value}</dd>
    </div>
  );
}

export function EntityDetailPanel({ entity, type, onClose }: { entity: any; type: string; onClose: () => void }) {
  const meta = entity.metadata || {};
  return (
    <div className="border border-white/5 bg-ink-850 p-6">
      <div className="flex items-start justify-between mb-4">
        <Avatar name={entity.label} type={type as any} size={56} />
        <button onClick={onClose} className="text-ink-500 hover:text-ink-50 transition-colors text-lg leading-none">×</button>
      </div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500">{type === 'person' ? 'Director / Officer' : type}</div>
      <div className="flex items-start justify-between mt-1">
        <h3 className="font-medium text-ink-50 break-words">{entity.label}</h3>
        {type === 'person' && meta.personId && (
          <Link
            href={`/person/${meta.personId}`}
            className="text-[9px] font-mono text-[#d4ff00]/50 hover:text-[#d4ff00] transition-colors shrink-0 ml-2 mt-0.5 whitespace-nowrap"
          >
            Track record →
          </Link>
        )}
      </div>

      <dl className="mt-6 space-y-3 text-sm border-t border-white/5 pt-4">
        {meta.companyProfile && <DetailField label="Profile" value={meta.companyProfile} />}
        {meta.status && <DetailField label="Status" value={meta.status} />}
        {meta.companyType && <DetailField label="Type" value={meta.companyType} />}
        {meta.incorporationDate && <DetailField label="Incorporated" value={meta.incorporationDate} />}
        {meta.dissolutionDate && <DetailField label="Dissolved" value={meta.dissolutionDate} highlight />}
        {meta.jurisdiction && <DetailField label="Jurisdiction" value={meta.jurisdiction} />}
        {meta.accountsType && <DetailField label="Accounts" value={meta.accountsType} />}
        {meta.nationality && <DetailField label="Nationality" value={meta.nationality} />}
        {meta.dateOfBirth?.year && <DetailField label="Born" value={`${meta.dateOfBirth.month || ''}/${meta.dateOfBirth.year}`} />}
        {meta.directorProfile && (
          <DetailField label="Director risk" value={meta.directorProfile.risk} highlight={meta.directorProfile.risk === 'NOMINEE_PATTERN' || meta.directorProfile.risk === 'FORMATION_AGENT'} />
        )}
        {meta.directorProfile?.totalAppointments !== undefined && (
          <DetailField label="Appointments" value={`${meta.directorProfile.active} active · ${meta.directorProfile.dissolved} dissolved`} />
        )}
        {entity.proximityScore && entity.proximityScore !== 'CLEAR' && (
          <DetailField label="Proximity" value={entity.proximityScore} highlight />
        )}
        {meta.shellCompanyScore?.risk && meta.shellCompanyScore.risk !== 'LOW' && (
          <DetailField label="Shell risk" value={meta.shellCompanyScore.risk} highlight />
        )}
        {meta.addressAnalysis?.classification && (
          <DetailField label="Address class" value={meta.addressAnalysis.classification} highlight={meta.addressAnalysis.classification === 'VIRTUAL_OFFICE' || meta.addressAnalysis.classification === 'FORMATION_AGENT'} />
        )}
        {meta.companyCount !== undefined && (
          <DetailField label="Companies here" value={String(meta.companyCount)} highlight={meta.companyCount > 5} />
        )}
        {entity.degree !== undefined && <DetailField label="Connections" value={String(entity.degree)} />}
        {entity.matches?.length > 0 && (
          <DetailField label="Sanctions" value={`${entity.matches.length} match${entity.matches.length > 1 ? 'es' : ''}`} highlight />
        )}
      </dl>

      {/* Address map */}
      {type === 'address' && (
        <div className="mt-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Location</div>
          <AddressMap address={entity.label} />
        </div>
      )}

      {/* Shell company evidence */}
      {meta.shellCompanyScore?.reasons?.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Shell signals</div>
          <ul className="space-y-1.5">
            {meta.shellCompanyScore.reasons.map((r: string, i: number) => (
              <li key={i} className="text-xs text-ink-300 flex gap-2">
                <span className="text-ink-500">›</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Director profile reasons */}
      {meta.directorProfile?.reasons?.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Director signals</div>
          <ul className="space-y-1.5">
            {meta.directorProfile.reasons.map((r: string, i: number) => (
              <li key={i} className="text-xs text-ink-300 flex gap-2">
                <span className="text-ink-500">›</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Match details */}
      {entity.matches?.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-2">/ Cross-source matches</div>
          <div className="space-y-2">
            {entity.matches.map((m: any) => (
              <div key={m.id} className="text-xs border border-white/5 p-2 rounded-sm bg-ink-900">
                <div className="flex items-center justify-between">
                  <span className="text-ink-300">{m.reasons?.matchedName || m.matchedEntityId}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${
                    m.confidence >= 75 ? 'bg-signal-critical text-ink-900' : 'bg-signal-medium text-ink-900'
                  }`}>{m.confidence}%</span>
                </div>
                <div className="text-[10px] font-mono text-ink-500 mt-0.5">{m.source === 'opensanctions' ? 'OpenSanctions' : 'ICIJ OffshoreLeaks'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
