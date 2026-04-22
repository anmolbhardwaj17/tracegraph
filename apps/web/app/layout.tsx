import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '../components/AuthProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TraceGraph · Corporate intelligence engine',
  description: 'Autonomous corporate intelligence from public data sources.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-ink-900 text-ink-50 antialiased font-sans grain">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
