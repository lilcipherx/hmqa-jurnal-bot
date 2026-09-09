import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { currentLocale } from '../lib/locale';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'HMQA JURNAL BOT', template: '%s · HMQA JURNAL BOT' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await currentLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
