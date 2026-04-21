'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Insights } from '../../../../components/Insights';
import { NetworkGlobe } from '../../../../components/NetworkGlobe';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function OverviewPage() {
  const { id } = useParams() as { id: string };
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/investigations/${id}/overview`).then((r) => r.json()),
      fetch(`${API}/api/investigations/${id}/locations`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/investigations/${id}/matches`).then((r) => r.json()).catch(() => null),
    ])
      .then(([overview, locations, matchData]) => {
        const addresses = locations?.addresses || [];
        const jurisdictions = new Set<string>();
        for (const a of addresses) {
          const country = a.metadata?.geo?.displayName?.split(',').pop()?.trim() || a.metadata?.country || a.label?.split(',').pop()?.trim();
          if (country && country.length > 1) jurisdictions.add(country.toLowerCase());
        }
        // Count risky entities from findings
        const riskyEntities = new Set<string>();
        for (const f of overview.findings || []) {
          if (f.severity === 'CRITICAL' || f.severity === 'HIGH') {
            for (const eid of f.affectedEntities || []) riskyEntities.add(eid);
          }
        }
        setData({
          ...overview,
          addressCount: addresses.length,
          jurisdictionCount: jurisdictions.size,
          sanctionsMatches: (matchData?.matches || []).length,
          riskyEntityCount: riskyEntities.size,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Skeleton />;
  if (!data) return <div className="text-ink-500 text-sm font-mono">Failed to load overview</div>;

  const score = data.riskScore ?? 0;
  const scoreColor = score >= 75 ? 'text-signal-critical' : score >= 50 ? 'text-signal-high' : score >= 25 ? 'text-signal-medium' : 'text-signal-clean';
  const ringColor = score >= 75 ? '#FF4D4D' : score >= 50 ? '#FF8A3D' : score >= 25 ? '#F5C518' : '#5EE6A1';
  const circumference = 2 * Math.PI * 45;
  const progress = (score / 100) * circumference;
  const classification = data.riskClassification || (score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MEDIUM' : 'LOW');

  // Fallback: compute breakdown from score if not provided by backend
  if (!data.scoreBreakdown && score > 0) {
    const sanctionFindings = (data.findings || []).filter((f: any) => f.type === 'SANCTIONS_PROXIMITY' || f.type === 'HIGH_RISK_JURISDICTION');
    const directorFindings = (data.findings || []).filter((f: any) => f.type === 'DISQUALIFIED_DIRECTOR' || f.type === 'DIRECTOR_VELOCITY' || f.type === 'DIRECTOR_NOMINEE_PATTERN');
    data.scoreBreakdown = {
      sanctions: Math.min(40, sanctionFindings.length * 10),
      structural: Math.min(40, Math.max(0, score - sanctionFindings.length * 10 - directorFindings.length * 5)),
      director: Math.min(20, directorFindings.length * 5),
    };
  }

  const findings = data.findings || [];
  const topActions = findings.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH').slice(0, 3);
  const remainingFindings = findings.filter((f: any) => !topActions.includes(f));

  return (
    <div className="space-y-8">
      {/* ROW 1: Score gauge (narrow) + Network numbers (wide) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Score gauge */}
        <div className="lg:col-span-4 border border-white/5 bg-ink-850 p-6 flex items-center gap-6">
          <div className="relative w-28 h-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
              <circle cx="50" cy="50" r="45" fill="none" stroke={ringColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-3xl font-medium tabular-nums ${scoreColor}`}>{score}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-1">{data.targetCompany}'s risk profile</div>
            <div className={`text-xl font-medium ${scoreColor}`}>{classification}</div>
            {data.percentile != null && data.benchmarks?.totalInvestigations >= 3 && (
              <div className="mt-3">
                <div className="text-xs text-ink-400">Higher than {data.percentile}% of investigated companies</div>
                <div className="relative mt-2 h-2 w-48 bg-white/5 rounded-full overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-signal-clean via-signal-medium to-signal-critical rounded-full" style={{ width: '100%', opacity: 0.3 }} />
                  <div className="absolute top-0 w-1.5 h-full bg-ink-50 rounded-full" style={{ left: `${Math.min(97, data.percentile)}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[8px] font-mono text-ink-600 w-48">
                  <span>0</span>
                  <span>{data.benchmarks.totalInvestigations} investigations</span>
                  <span>100</span>
                </div>
              </div>
            )}
            <div className="text-[10px] font-mono text-ink-500 mt-3">{findings.length} findings detected</div>
          </div>
        </div>

        {/* Network numbers */}
        <div className="lg:col-span-8 border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-5">{data.targetCompany}'s network</div>
          <div className="grid grid-cols-4 gap-6">
            <div>
              <div className="text-3xl font-medium text-ink-50 tabular-nums">{data.counts?.people || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">directors & officers</div>
            </div>
            <div>
              <div className="text-3xl font-medium text-ink-50 tabular-nums">{data.counts?.companies || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">connected companies</div>
            </div>
            <div>
              <div className={`text-3xl font-medium tabular-nums ${data.riskyEntityCount > 0 ? 'text-signal-critical' : 'text-signal-clean'}`}>{data.riskyEntityCount || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">flagged entities</div>
            </div>
            <div>
              <div className={`text-3xl font-medium tabular-nums ${data.sanctionsMatches > 0 ? 'text-signal-critical' : 'text-signal-clean'}`}>{data.sanctionsMatches || 0}</div>
              <div className="text-[10px] font-mono text-ink-500 mt-1">sanctions matches</div>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 2: AI Risk Narrative (if available) */}
      {data.narrative && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ AI Risk Narrative</div>
            <div className="text-[10px] font-mono text-ink-600">Generated {data.narrative.generatedAt ? new Date(data.narrative.generatedAt).toLocaleDateString() : ''}</div>
          </div>

          {/* Executive Summary */}
          <p className="text-sm text-ink-200 leading-relaxed mb-5">{data.narrative.executiveSummary}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Key Findings */}
            {data.narrative.keyFindings?.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Key findings</div>
                <ul className="space-y-2">
                  {data.narrative.keyFindings.map((f: string, i: number) => (
                    <li key={i} className="text-xs text-ink-300 leading-relaxed flex gap-2">
                      <span className="text-signal-clean shrink-0 mt-0.5">-</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {data.narrative.recommendations?.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Recommendations</div>
                <ul className="space-y-2">
                  {data.narrative.recommendations.map((r: string, i: number) => (
                    <li key={i} className="text-xs text-ink-300 leading-relaxed flex gap-2">
                      <span className="text-ink-500 shrink-0 mt-0.5">{i + 1}.</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* PEP Warnings */}
          {data.narrative.pepWarnings?.length > 0 && (
            <div className="mt-5 border-t border-white/5 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-high/15 text-signal-high border-signal-high/30">PEP</span>
                <span className="text-[10px] font-mono text-ink-500">{data.narrative.pepWarnings.length} Politically Exposed Person{data.narrative.pepWarnings.length !== 1 ? 's' : ''}</span>
              </div>
              {data.narrative.pepWarnings.map((w: string, i: number) => (
                <p key={i} className="text-xs text-signal-high/80 leading-relaxed mb-1">{w}</p>
              ))}
            </div>
          )}

          {/* Adverse Media */}
          {data.narrative.adverseMedia?.length > 0 && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border bg-signal-medium/15 text-signal-medium border-signal-medium/30">MEDIA</span>
                <span className="text-[10px] font-mono text-ink-500">{data.narrative.adverseMedia.length} adverse media hit{data.narrative.adverseMedia.length !== 1 ? 's' : ''}</span>
              </div>
              {data.narrative.adverseMedia.map((m: string, i: number) => (
                <p key={i} className="text-xs text-ink-400 leading-relaxed mb-1">{m}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ROW 2c: Intelligence Dashboard */}
      {(data.companyProfile || data.secIntelligence || data.webIntelligence || data.wayback || data.politicalDonations) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Company Profile Card */}
          {data.companyProfile && (data.companyProfile.revenue || data.companyProfile.employees) && (
            <div className="border border-white/5 bg-ink-850 p-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Company profile</div>
              <div className="space-y-2">
                {data.companyProfile.revenue && <div className="flex justify-between"><span className="text-[10px] text-ink-500">Revenue</span><span className="text-sm font-medium text-ink-100">{data.companyProfile.revenue}</span></div>}
                {data.companyProfile.employees && <div className="flex justify-between"><span className="text-[10px] text-ink-500">Employees</span><span className="text-sm font-medium text-ink-100">{data.companyProfile.employees}</span></div>}
                {data.companyProfile.industry && <div className="flex justify-between"><span className="text-[10px] text-ink-500">Industry</span><span className="text-xs text-ink-300 text-right max-w-[120px] truncate">{data.companyProfile.industry}</span></div>}
                {data.companyProfile.founded && <div className="flex justify-between"><span className="text-[10px] text-ink-500">Founded</span><span className="text-xs text-ink-300">{data.companyProfile.founded}</span></div>}
                {data.companyProfile.ticker && <div className="flex justify-between"><span className="text-[10px] text-ink-500">Ticker</span><span className="text-xs text-ink-300">{data.companyProfile.ticker} ({data.companyProfile.exchange})</span></div>}
              </div>
            </div>
          )}

          {/* Financial Ratios Card */}
          {data.secIntelligence?.financials && (
            <div className="border border-white/5 bg-ink-850 p-5">
              <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Financial health</div>
              <div className="space-y-2">
                {data.secIntelligence.financials.profitMargin != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-ink-500">Profit margin</span>
                    <span className={`text-sm font-medium ${data.secIntelligence.financials.profitMargin < 0 ? 'text-signal-critical' : data.secIntelligence.financials.profitMargin < 5 ? 'text-signal-medium' : 'text-signal-clean'}`}>
                      {data.secIntelligence.financials.profitMargin}%
                    </span>
                  </div>
                )}
                {data.secIntelligence.financials.debtToEquity != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-ink-500">Debt / equity</span>
                    <span className={`text-sm font-medium ${data.secIntelligence.financials.debtToEquity > 3 ? 'text-signal-critical' : data.secIntelligence.financials.debtToEquity > 1.5 ? 'text-signal-medium' : 'text-ink-100'}`}>
                      {data.secIntelligence.financials.debtToEquity}
                    </span>
                  </div>
                )}
                {data.secIntelligence.financials.currentRatio != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-ink-500">Current ratio</span>
                    <span className={`text-sm font-medium ${data.secIntelligence.financials.currentRatio < 1 ? 'text-signal-critical' : data.secIntelligence.financials.currentRatio < 1.5 ? 'text-signal-medium' : 'text-signal-clean'}`}>
                      {data.secIntelligence.financials.currentRatio}
                    </span>
                  </div>
                )}
                {data.secIntelligence.financials.flags?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    {data.secIntelligence.financials.flags.map((f: string, i: number) => (
                      <span key={i} className="inline-block text-[8px] font-mono px-1.5 py-0.5 mr-1 mb-1 rounded-sm bg-signal-critical/15 text-signal-critical border border-signal-critical/30">
                        {f.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}
                {(!data.secIntelligence.financials.flags || data.secIntelligence.financials.flags.length === 0) && (
                  <div className="mt-2 pt-2 border-t border-white/5">
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded-sm bg-signal-clean/15 text-signal-clean border border-signal-clean/30">HEALTHY</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Web Intelligence Card */}
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Web intelligence</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-ink-500">Website</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${data.webIntelligence?.websiteExists ? 'bg-signal-clean/15 text-signal-clean border-signal-clean/30' : 'bg-signal-critical/15 text-signal-critical border-signal-critical/30'}`}>
                  {data.webIntelligence?.websiteExists ? 'VERIFIED' : 'NOT FOUND'}
                </span>
              </div>
              {data.wayback?.firstSnapshot && (
                <div className="flex justify-between"><span className="text-[10px] text-ink-500">Online since</span><span className="text-xs text-ink-300">{data.wayback.firstSnapshot}</span></div>
              )}
              {data.wayback?.domainAgeYears != null && (
                <div className="flex justify-between"><span className="text-[10px] text-ink-500">Domain age</span><span className="text-xs text-ink-300">{data.wayback.domainAgeYears} years</span></div>
              )}
              <div className="flex justify-between"><span className="text-[10px] text-ink-500">Court cases</span><span className="text-sm font-medium text-ink-100">{data.webIntelligence?.courtCases || 0}</span></div>
              <div className="flex justify-between"><span className="text-[10px] text-ink-500">Gov contracts</span><span className="text-sm font-medium text-ink-100">{data.webIntelligence?.govContracts || 0}</span></div>
            </div>
          </div>

          {/* Compliance Signals Card */}
          <div className="border border-white/5 bg-ink-850 p-5">
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-ink-500 mb-3">Compliance signals</div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-ink-500">OFAC / UK HMT</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${(data.directSanctions?.matches || 0) > 0 ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' : 'bg-signal-clean/15 text-signal-clean border-signal-clean/30'}`}>
                  {(data.directSanctions?.matches || 0) > 0 ? `${data.directSanctions.matches} MATCH` : 'CLEAR'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-ink-500">PEP screening</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${(data.pepCount || 0) > 0 ? 'bg-signal-high/15 text-signal-high border-signal-high/30' : 'bg-signal-clean/15 text-signal-clean border-signal-clean/30'}`}>
                  {(data.pepCount || 0) > 0 ? `${data.pepCount} PEP${data.pepCount !== 1 ? 's' : ''}` : 'CLEAR'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-ink-500">Adverse media</span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${(data.adverseMediaCount || 0) > 0 ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' : 'bg-signal-clean/15 text-signal-clean border-signal-clean/30'}`}>
                  {(data.adverseMediaCount || 0) > 0 ? `${data.adverseMediaCount} HIT${data.adverseMediaCount !== 1 ? 'S' : ''}` : 'CLEAR'}
                </span>
              </div>
              {(data.politicalDonations?.totalDonations || 0) > 0 && (
                <div className="flex justify-between"><span className="text-[10px] text-ink-500">Political donations</span><span className="text-xs text-ink-300">${(data.politicalDonations.totalAmount || 0).toLocaleString()}</span></div>
              )}
              {data.regulatoryViolations && (data.regulatoryViolations.epa > 0 || data.regulatoryViolations.osha > 0) && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-ink-500">Regulatory</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm border bg-signal-high/15 text-signal-high border-signal-high/30">
                    {data.regulatoryViolations.epa + data.regulatoryViolations.osha} VIOLATION{data.regulatoryViolations.epa + data.regulatoryViolations.osha !== 1 ? 'S' : ''}
                  </span>
                </div>
              )}
              {data.addressVerification?.flagged > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-ink-500">Address flags</span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm border bg-signal-medium/15 text-signal-medium border-signal-medium/30">
                    {data.addressVerification.flagged} FLAGGED
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ROW 2b: AI Insights + Globe */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Insights */}
        <div className="lg:col-span-8" style={{ minHeight: 300 }}>
          <Insights investigationId={id} topic="overview" />
        </div>

        {/* Globe */}
        <div className="lg:col-span-4">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            Geographic footprint
          </div>
          <div className="border border-white/5 bg-ink-850 relative overflow-hidden" style={{ minHeight: 280 }}>
            <div className="absolute top-5 left-5 z-10">
              <div className="text-sm text-ink-300">{data.addressCount || 0} addresses - {data.jurisdictionCount || 0} jurisdiction{(data.jurisdictionCount || 0) === 1 ? '' : 's'}</div>
            </div>
            <NetworkGlobe />
          </div>
        </div>
      </div>

      {/* ROW 3: Score breakdown - compact strip */}
      <div className="border border-white/5 bg-ink-850 px-6 py-4">
        <div className="flex items-center gap-8 flex-wrap">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 shrink-0">Risk breakdown</div>
          {[
            { label: 'Sanctions', value: data.scoreBreakdown?.sanctions, max: 40, color: 'bg-signal-critical' },
            { label: 'Structural', value: data.scoreBreakdown?.structural, max: 40, color: 'bg-signal-high' },
            { label: 'Director', value: data.scoreBreakdown?.director, max: 20, color: 'bg-signal-medium' },
          ].map((bar) => (
            <div key={bar.label} className="flex items-center gap-3 flex-1 min-w-[140px]">
              <span className="text-[10px] text-ink-400 shrink-0">{bar.label}</span>
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full ${bar.color} rounded-full`} style={{ width: `${((bar.value || 0) / bar.max) * 100}%` }} />
              </div>
              <span className="text-[10px] font-mono text-ink-500 tabular-nums shrink-0">{bar.value || 0}/{bar.max}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ROW 3b: Network Red Flags */}
      {(() => {
        const redFlagTypes = ['PEP_DETECTED', 'DIRECT_SANCTIONS_HIT', 'ADVERSE_MEDIA', 'INSIDER_SELLING',
          'MATERIAL_EVENT', 'SELF_DISCLOSED_RISK', 'FINANCIAL_DISTRESS', 'LITIGATION', 'EPA_VIOLATION',
          'OSHA_VIOLATION', 'NO_WEB_PRESENCE', 'PARKED_WEBSITE', 'NEW_DOMAIN', 'WEBSITE_AGE_MISMATCH',
          'NO_WEB_HISTORY', 'VIRTUAL_OFFICE_ADDRESS', 'FORMATION_AGENT_ADDRESS', 'POLITICAL_DONOR', 'POLITICAL_NETWORK'];
        const redFlags = findings.filter((f: any) => redFlagTypes.includes(f.type));
        if (redFlags.length === 0) return null;
        return (
          <div className="border border-white/5 bg-ink-850 p-6">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Intelligence red flags ({redFlags.length})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {redFlags.slice(0, 9).map((f: any, i: number) => {
                const typeLabels: Record<string, string> = {
                  PEP_DETECTED: 'PEP', DIRECT_SANCTIONS_HIT: 'SANCTIONS', ADVERSE_MEDIA: 'MEDIA',
                  INSIDER_SELLING: 'INSIDER', MATERIAL_EVENT: '8-K', SELF_DISCLOSED_RISK: '10-K RISK',
                  FINANCIAL_DISTRESS: 'FINANCIAL', LITIGATION: 'COURT', EPA_VIOLATION: 'EPA',
                  OSHA_VIOLATION: 'OSHA', NO_WEB_PRESENCE: 'WEB', PARKED_WEBSITE: 'WEB',
                  WEBSITE_AGE_MISMATCH: 'WAYBACK', NO_WEB_HISTORY: 'WAYBACK', VIRTUAL_OFFICE_ADDRESS: 'ADDRESS',
                  FORMATION_AGENT_ADDRESS: 'ADDRESS', POLITICAL_DONOR: 'FEC', POLITICAL_NETWORK: 'FEC',
                  NEW_DOMAIN: 'DOMAIN',
                };
                return (
                  <div key={i} className="flex items-start gap-2 p-3 border border-white/5 rounded-sm">
                    <span className={`text-[7px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border shrink-0 mt-0.5 ${
                      f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                      f.severity === 'HIGH' ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
                      f.severity === 'MEDIUM' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
                      'bg-white/5 text-ink-400 border-white/10'
                    }`}>{typeLabels[f.type] || f.type}</span>
                    <span className="text-[11px] text-ink-300 leading-snug">{f.title}</span>
                  </div>
                );
              })}
            </div>
            {redFlags.length > 9 && (
              <div className="text-[10px] font-mono text-ink-500 mt-3">+ {redFlags.length - 9} more intelligence flags</div>
            )}
          </div>
        );
      })()}

      {/* ROW 4: Top 3 actions */}
      {topActions.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">/ Immediate attention required</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topActions.map((f: any, i: number) => (
              <div key={i} className="border border-white/5 bg-ink-850 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${
                    f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                    'bg-signal-high/15 text-signal-high border-signal-high/30'
                  }`}>{f.severity}</span>
                  <span className="text-[9px] font-mono text-ink-600">{f.type}</span>
                </div>
                <div className="text-sm text-ink-50 mb-3 leading-snug">{f.title}</div>
                {f.businessImpact && (
                  <p className="text-[11px] text-ink-400 leading-relaxed mb-3">{f.businessImpact.slice(0, 150)}...</p>
                )}
                {f.verificationSteps && f.verificationSteps.length > 0 && (
                  <div className="space-y-1">
                    {f.verificationSteps.slice(0, 2).map((s: string, si: number) => (
                      <div key={si} className="text-[10px] text-ink-500 flex gap-1.5">
                        <span className="text-ink-600 shrink-0">{si + 1}.</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ROW 5: Remaining findings */}
      {remainingFindings.length > 0 && (
        <div className="border border-white/5 bg-ink-850 p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-4">
            Key risk signals in {data.targetCompany}'s network ({remainingFindings.length})
          </div>
          <div className="space-y-2">
            {remainingFindings.slice(0, 10).map((f: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-b-0">
                <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-sm border shrink-0 ${
                  f.severity === 'CRITICAL' ? 'bg-signal-critical/15 text-signal-critical border-signal-critical/30' :
                  f.severity === 'HIGH' ? 'bg-signal-high/15 text-signal-high border-signal-high/30' :
                  f.severity === 'MEDIUM' ? 'bg-signal-medium/15 text-signal-medium border-signal-medium/30' :
                  'bg-white/5 text-ink-400 border-white/10'
                }`}>{f.severity}</span>
                <span className="text-xs text-ink-300 truncate">{f.title}</span>
              </div>
            ))}
            {remainingFindings.length > 10 && (
              <div className="text-[10px] font-mono text-ink-500 pt-2">+ {remainingFindings.length - 10} more findings</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="h-48 bg-white/5 rounded-sm" />
        <div className="h-48 bg-white/5 rounded-sm" />
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="h-56 bg-white/5 rounded-sm" />
        <div className="h-56 bg-white/5 rounded-sm" />
      </div>
      <div className="h-40 bg-white/5 rounded-sm" />
    </div>
  );
}
