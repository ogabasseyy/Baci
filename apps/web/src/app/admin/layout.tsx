import { redirect } from 'next/navigation';
import { AppSansFont } from '@/app/app-sans-font';
import '@/app/globals.css';
import { type ReactNode, Suspense } from 'react';
import { CsrfInitializer } from '@/components/csrf-initializer';
import { getPlatformAdminContextAuth } from '@/lib/platform-admin-auth';
import { AdminShell } from './admin-shell';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppSansFont>
      <Suspense fallback={<AdminLayoutFallback />}>
        <AdminLayoutContent>{children}</AdminLayoutContent>
      </Suspense>
    </AppSansFont>
  );
}

/** Exported so layout tests can exercise resolved auth and redirect paths. */
export async function AdminLayoutContent({
  children,
}: {
  children: ReactNode;
}) {
  const auth = await getPlatformAdminContextAuth();

  if (auth.status === 'unauthenticated') {
    redirect('/login?redirect=%2Fadmin');
  }

  if (auth.status === 'forbidden') {
    redirect('/dashboard');
  }

  return (
    <>
      <CsrfInitializer />
      <AdminShell adminContext={auth.context} adminEmail={auth.user.email}>
        {children}
      </AdminShell>
    </>
  );
}

function AdminLayoutFallback() {
  return (
    <output
      className="block min-h-screen bg-background text-foreground"
      aria-live="polite"
    >
      <span className="sr-only">Loading admin workspace</span>
    </output>
  );
}
