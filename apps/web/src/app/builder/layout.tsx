import type { ReactNode } from 'react';
import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import { AuthProvider } from '@/contexts/auth-context';

export default function BuilderLayout({ children }: { children: ReactNode }) {
  return (
    <AppSansFont>
      <AuthProvider>{children}</AuthProvider>
    </AppSansFont>
  );
}
