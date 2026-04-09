import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service · TraceGraph',
};

export default function TermsPage() {
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
            / Terms of service
          </div>
          <h1 className="text-4xl font-medium tracking-tight text-ink-50">Terms of Service</h1>
          <p className="text-sm text-ink-500 font-mono mt-2">Last updated: April 9, 2026</p>
        </div>

        <Section title="1. Agreement">
          By accessing or using TraceGraph (&ldquo;the service&rdquo;) you agree to these Terms of
          Service. If you do not agree, do not use the service.
        </Section>

        <Section title="2. The service">
          TraceGraph is a corporate intelligence tool that aggregates publicly available company
          information (UK Companies House, OpenSanctions, ICIJ OffshoreLeaks, and other public sources)
          and produces risk reports, ownership graphs, and AI-generated insight summaries. The service
          is provided on an as-is, as-available basis.
        </Section>

        <Section title="3. Permitted use">
          <ul className="space-y-2">
            <Li>Lawful research, due diligence, journalism, compliance screening, and similar
              legitimate uses of public information.</Li>
            <Li>You are responsible for ensuring your use complies with all applicable laws in your
              jurisdiction, including data-protection regulations.</Li>
          </ul>
        </Section>

        <Section title="4. Prohibited use">
          <ul className="space-y-2">
            <Li>Harassment, stalking, or targeted intimidation of individuals identified through
              the service.</Li>
            <Li>Building or training competing datasets by scraping or otherwise systematically
              extracting data beyond your reasonable individual research use.</Li>
            <Li>Reverse-engineering, redistributing, sublicensing, or reselling the service or its
              outputs without prior written permission.</Li>
            <Li>Attempting to bypass rate limits, security controls, or access controls.</Li>
            <Li>Any activity that is unlawful in your jurisdiction or that violates the terms of any
              upstream data provider.</Li>
          </ul>
        </Section>

        <Section title="5. Intellectual property">
          The TraceGraph software, brand, and original report layouts are the property of the operator
          and protected by applicable copyright and trademark law. The underlying public data belongs
          to its original publishers and remains subject to their respective terms. You may not claim
          ownership of TraceGraph reports.
        </Section>

        <Section title="6. No professional advice">
          TraceGraph reports are an aggregation of public data and algorithmic risk signals. They are
          <strong className="text-ink-100"> not</strong> legal, financial, investment, or compliance
          advice, and they are not a substitute for professional due diligence. Risk scores and
          AI-generated insights are heuristic and may contain false positives or false negatives.
          You are responsible for independently verifying any information before acting on it.
        </Section>

        <Section title="7. Accuracy and limitations">
          We make no warranty as to the accuracy, completeness, or timeliness of the data. Public
          registry data is updated by third parties on their own schedules. Bulk reference datasets
          included in the service are sample subsets unless explicitly noted. AI-generated insights
          are produced by third-party language models and may be wrong.
        </Section>

        <Section title="8. Limitation of liability">
          To the maximum extent permitted by law, the operator of TraceGraph shall not be liable for
          any indirect, incidental, special, consequential, or punitive damages, or any loss of
          profits, revenue, data, or goodwill, arising out of or related to your use of the service.
          The total cumulative liability shall not exceed the amount you paid to use the service in
          the previous twelve months (which, if you are using a free tier, is zero).
        </Section>

        <Section title="9. Indemnification">
          You agree to indemnify and hold harmless the operator from any claims, damages, or expenses
          arising out of your misuse of the service or your violation of these terms.
        </Section>

        <Section title="10. Termination">
          We may suspend or terminate access to the service at any time, with or without notice, for
          conduct we believe violates these terms or is harmful to other users, the upstream data
          providers, or the operator.
        </Section>

        <Section title="11. Changes to these terms">
          We may update these terms periodically. Material changes will be reflected by updating the
          &ldquo;Last updated&rdquo; date at the top of this page. Continued use after the change
          constitutes acceptance.
        </Section>

        <Section title="12. Governing law">
          These terms are governed by the laws of the jurisdiction in which the operator is
          established, without regard to conflict-of-laws principles.
        </Section>

        <Section title="13. Contact">
          Questions about these terms can be directed to the operator at{' '}
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
            <a href="/privacy" className="hover:text-ink-50 transition-colors">Privacy</a>
            <span className="text-ink-700">·</span>
            <a href="/terms" className="text-ink-50">Terms</a>
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
