import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bettr',
  description: 'Get Bettr. Together. Private self-improvement for you and your people.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
