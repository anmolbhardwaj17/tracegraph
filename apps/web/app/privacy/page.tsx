import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · TraceGraph',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-white/5">
        <div className="max-w-3xl mx-auto px-8 py-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-xs text-ink-500 hover:text-ink-50 transition-colors font-mono">
            <span>←</span> TraceGraph
          </Link>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500">/ Legal</div>
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-8 py-16 space-y-10">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ink-500 mb-3">
            / Privacy policy
          </div>
          <h1 className="text-4xl font-medium tracking-tight text-ink-50">Privacy Policy</h1>
          <p className="text-sm text-ink-500 font-mono mt-2">Last updated: April 9, 2026</p>
        </div>

        <Section title="1. Introduction">
          TraceGraph (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the service&rdquo;) is a corporate intelligence
          tool that aggregates publicly available company information to produce risk reports. This policy
          describes what information we collect, how it is used, and the choices available to you.
        </Section>

        <Section title="2. Information we collect">
          <ul className="space-y-2">
            <Li>
              <strong className="text-ink-100">Search queries.</strong> Company names and registration
              numbers you submit for investigation. These are stored alongside the investigation result
              so they can be re-opened from the recent list.
            </Li>
            <Li>
              <strong className="text-ink-100">Public corporate data.</strong> Company profiles, officer
              records, addresses, and ownership information retrieved from official public registries
              (currently UK Companies House) and from publicly published reference datasets
              (OpenSanctions, ICIJ OffshoreLeaks).
            </Li>
            <Li>
              <strong className="text-ink-100">Technical data.</strong> Standard web request metadata
              such as IP address, browser type, and timestamps. Used for security, abuse prevention,
              and aggregate usage statistics.
            </Li>
            <Li>
              <strong className="text-ink-100">No personal accounts.</strong> TraceGraph does not require
              registration. We do not collect names, email addresses, payment information, or
              identifiers of you as the user.
            </Li>
          </ul>
        </Section>

        <Section title="3. How information is used">
          <ul className="space-y-2">
            <Li>To execute the investigation you requested and return its result.</Li>
            <Li>To cache responses from upstream public registries so repeat investigations are faster
              and use less of the third-party API quota.</Li>
            <Li>To compute risk scores, anomaly findings, and AI-generated insights from the aggregated
              public data.</Li>
            <Li>To monitor and protect the service from abuse.</Li>
          </ul>
        </Section>

        <Section title="4. Public data and individuals">
          The information surfaced by TraceGraph (director names, dates of birth, addresses, ownership
          shares) is sourced exclusively from public registries that are designed to be accessible. We do
          not enrich this data with private or non-public sources. If you believe information surfaced
          about you is inaccurate or should be corrected at source, please contact the original publisher
          (e.g. Companies House for UK records).
        </Section>

        <Section title="5. Third parties">
          <ul className="space-y-2">
            <Li><strong className="text-ink-100">UK Companies House</strong> · live API requests for company profiles, officers, and PSC.</Li>
            <Li><strong className="text-ink-100">OpenSanctions</strong> · bulk dataset for sanctions and PEP screening.</Li>
            <Li><strong className="text-ink-100">ICIJ OffshoreLeaks</strong> · bulk dataset of published offshore corporate records.</Li>
            <Li><strong className="text-ink-100">OpenStreetMap Nominatim</strong> · geocoding for address coordinates.</Li>
            <Li><strong className="text-ink-100">DuckDuckGo / Google</strong> · favicon services for company logos.</Li>
            <Li><strong className="text-ink-100">Wikipedia</strong> · public summary data for known persons.</Li>
            <Li><strong className="text-ink-100">OpenRouter</strong> · large-language-model API used for AI-generated insight summaries. Only the aggregated investigation briefing is sent · never your personal data.</Li>
          </ul>
        </Section>

        <Section title="6. Data retention">
          Investigation results, risk scores, and cached upstream responses may be retained indefinitely
          for performance and so prior investigations remain accessible. Geocoded address coordinates are
          cached so the same address is not re-resolved on every run. You may request deletion of any
          investigation by contacting us.
        </Section>

        <Section title="7. Cookies">
          TraceGraph does not use tracking or advertising cookies. Strictly necessary cookies may be
          used for session integrity.
        </Section>

        <Section title="8. Security">
          We follow industry-standard practices to protect data in transit and at rest. No system is
          perfectly secure; if you discover a vulnerability please report it to the address below.
        </Section>

        <Section title="9. Your rights">
          Depending on your jurisdiction, you may have the right to access, correct, or request
          deletion of personal data we hold about you. Because TraceGraph re-publishes information
          from public registries, the ultimate source of correction is usually the original publisher.
        </Section>

        <Section title="10. Contact">
          Questions about this policy can be directed to the maintainer at{' '}
          <a href="https://anmolbhardwaj.com" target="_blank" rel="noopener noreferrer" className="text-ink-100 underline underline-offset-2 hover:text-ink-50">
            anmolbhardwaj.com
          </a>
          .
        </Section>
      </article>

      <footer className="border-t border-white/5 mt-16">
        <div className="max-w-6xl mx-auto px-8 py-12 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-ink-500 font-mono">
          <div>© 2026 TraceGraph. All rights reserved.</div>
          <div className="flex items-center gap-5">
            <a href="/privacy" className="text-ink-50">Privacy</a>
            <span className="text-ink-700">·</span>
            <a href="/terms" className="hover:text-ink-50 transition-colors">Terms</a>
            <span className="text-ink-700">·</span>
            <a href="https://anmolbhardwaj.com" target="_blank" rel="noopener noreferrer" className="hover:text-ink-50 transition-colors">
              anmolbhardwaj.com →
            </a>
          </div>
        </div>
      </footer>
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
      <span className="text-ink-500 mt-1">›</span>
      <span>{children}</span>
    </li>
  );
}
