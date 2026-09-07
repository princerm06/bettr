import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Himothy',
  description: 'Private self-improvement dashboard for you and your people.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
