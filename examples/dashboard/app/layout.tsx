import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'pg-workflows dashboard',
  description: 'Example app embedding the @pg-workflows/ui dashboard.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="pgw-root min-h-screen">{children}</body>
    </html>
  );
}
