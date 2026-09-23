import '@/app/globals.css';
import type { ReactNode } from 'react';
import { AppSansFont } from '@/app/app-sans-font';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <AppSansFont>{children}</AppSansFont>;
}
