import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppSansFontDocumentClass } from '@/app/app-sans-font-document-class';

const appSans = Inter({
  display: 'optional',
  preload: false,
  subsets: ['latin'],
  variable: '--font-sans',
});

interface AppSansFontProps {
  children: ReactNode;
}

/** Load Inter on dashboard/auth/admin/builder/checkout/landing without putting a webfont on the storefront LCP path. */
export function AppSansFont({ children }: AppSansFontProps) {
  const className = `${appSans.variable} font-sans`;

  return (
    <div className={className}>
      <AppSansFontDocumentClass className={className} />
      {children}
    </div>
  );
}
