import './globals.css';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { AuthProvider } from '../components/AuthProvider';

export const metadata: Metadata = {
  title: 'TraceGraph · Corporate intelligence engine',
  description: 'Autonomous corporate intelligence from public data sources.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="bg-ink-900 text-ink-50 antialiased grain" style={{ fontFamily: 'var(--font-geist-sans)' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
