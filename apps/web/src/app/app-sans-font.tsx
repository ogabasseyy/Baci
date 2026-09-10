import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

const appSans = Inter({
  display: 'optional',
  preload: false,
  subsets: ['latin'],
  variable: '--font-sans',
});

interface AppSansFontProps {
  children: ReactNode;
}

/** Load Inter on dashboard/auth/admin/builder without putting a webfont on the storefront LCP path. */
export function AppSansFont({ children }: AppSansFontProps) {
  return <div className={`${appSans.variable} font-sans`}>{children}</div>;
}
