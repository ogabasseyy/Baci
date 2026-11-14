import type { ReactNode } from 'react';
import '@/app/globals.css';

export default function OxygenPaymentLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className="light min-h-screen bg-white font-sans text-slate-900"
    >
      {children}
    </main>
  );
}
