import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - TraceGraph',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <nav className="sticky top-0 z-30 backdrop-blur-md bg-ink-900/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-sm bg-ink-50 text-ink-900 flex items-center justify-center font-mono text-xs font-bold">T</div>
            <span className="text-sm tracking-tight text-ink-50">TraceGraph</span>
          </Link>
          <div className="flex items-center gap-6 text-sm text-ink-300">
            <Link href="/dashboard" className="hover:text-ink-50 transition-colors hidden sm:block">Dashboard</Link>
            <Link href="/privacy" className="text-ink-50">Privacy</Link>
            <Link href="/terms" className="hover:text-ink-50 transition-colors">Terms</Link>
          </div>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-8 py-16 space-y-10">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">
            / Privacy policy
          </div>
          <h1 className="text-3xl font-medium tracking-tight text-ink-50">Privacy Policy</h1>
          <p className="text-sm text-ink-500 font-mono mt-2">Last updated: April 11, 2026</p>
        </div>

        <Section title="1. Introduction">
          TraceGraph ("we", "our", "the service") is a corporate intelligence platform that aggregates
          publicly available company information to produce risk reports. This policy describes what
          information we collect, how it is used, and the choices available to you.
        </Section>

        <Section title="2. Information we collect">
          <ul className="space-y-2">
            <Li>
              <strong className="text-ink-100">Search queries and investigations.</strong> Company names
              and registration numbers you submit for investigation, along with the resulting reports,
              risk scores, and findings.
            </Li>
            <Li>
              <strong className="text-ink-100">Watchlist and comparison data.</strong> Companies you add
              to your watchlist and investigations you compare are stored to enable those features.
            </Li>
            <Li>
              <strong className="text-ink-100">Public corporate data.</strong> Company profiles, officer
              records, addresses, ownership information, and filing history retrieved from official public
              registries (UK Companies House) and publicly published reference datasets (OpenSanctions,
              ICIJ OffshoreLeaks).
            </Li>
            <Li>
              <strong className="text-ink-100">API keys.</strong> If you use the TraceGraph API, we store
              a hashed version of your API key along with usage metrics for rate limiting purposes.
            </Li>
            <Li>
              <strong className="text-ink-100">Technical data.</strong> Standard web request metadata such
              as IP address, browser type, and timestamps for security and abuse prevention.
            </Li>
          </ul>
        </Section>

        <Section title="3. How information is used">
          <ul className="space-y-2">
            <Li>To execute investigations, generate risk reports, and return results.</Li>
            <Li>To cache responses from upstream registries for performance.</Li>
            <Li>To compute risk scores, anomaly findings, and AI-generated insights.</Li>
            <Li>To enable watchlist monitoring and company comparison features.</Li>
            <Li>To enforce API rate limits and protect the service from abuse.</Li>
          </ul>
        </Section>

        <Section title="4. Public data and individuals">
          The information surfaced by TraceGraph (director names, dates of birth, addresses, ownership
          shares) is sourced exclusively from public registries designed to be accessible. We do not
          enrich this data with private or non-public sources. If you believe information surfaced about
          you is inaccurate, please contact the original publisher (e.g. Companies House for UK records).
        </Section>

        <Section title="5. Third-party services">
          <ul className="space-y-2">
            <Li><strong className="text-ink-100">UK Companies House</strong> - company profiles, officers, PSC, filing history, charges, and disqualified directors register.</Li>
            <Li><strong className="text-ink-100">OpenSanctions</strong> - sanctions and PEP screening dataset (4.1M+ entities).</Li>
            <Li><strong className="text-ink-100">ICIJ OffshoreLeaks</strong> - offshore corporate records from Panama, Paradise, and Pandora Papers.</Li>
            <Li><strong className="text-ink-100">OpenStreetMap Nominatim</strong> - geocoding for address coordinates.</Li>
            <Li><strong className="text-ink-100">OpenRouter</strong> - language model API for AI-generated insight summaries. Only aggregated investigation briefings are sent, never personal data.</Li>
          </ul>
        </Section>

        <Section title="6. Data retention">
          Investigation results, risk scores, and cached upstream responses are retained to enable
          re-investigation and historical comparison. You may request deletion of any investigation
          through the dashboard or by contacting us.
        </Section>

        <Section title="7. Cookies">
          TraceGraph does not use tracking or advertising cookies. Strictly necessary cookies may be
          used for session integrity.
        </Section>

        <Section title="8. Security">
          We follow industry-standard practices to protect data in transit and at rest, including
          parameterized database queries, rate limiting, and API key hashing. No system is perfectly
          secure; if you discover a vulnerability please report it to the contact below.
        </Section>

        <Section title="9. Your rights">
          Depending on your jurisdiction, you may have the right to access, correct, or request deletion
          of data we hold. Because TraceGraph re-publishes information from public registries, the
          ultimate source of correction is the original publisher.
        </Section>

        <Section title="10. Contact">
          Questions about this policy can be directed to{' '}
          <a href="https://anmolbhardwaj.in" target="_blank" rel="noopener noreferrer" className="text-ink-100 underline underline-offset-2 hover:text-ink-50">
            anmolbhardwaj.in
          </a>.
        </Section>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-medium text-ink-50 mb-3 tracking-tight">{title}</h2>
      <div className="text-sm text-ink-300 leading-relaxed">{children}</div>
    </section>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-ink-500 mt-1">-</span>
      <span>{children}</span>
    </li>
  );
}
