import { connection } from 'next/server';
import { type ReactNode, Suspense } from 'react';
import { AppSansFont } from '@/app/app-sans-font';
import { documentViewport } from '@/app/document-viewport';
import '@/app/globals.css';
import { PasskeyEnrollmentPrompt } from '@/components/passkey-enrollment-prompt';
import { DashboardAuthGuard } from './auth-guard';
import DashboardLoading from './loading';

// The CSP nonce is generated per request. A prerendered dashboard shell
// would ship Next.js bootstrap scripts without that request's nonce.
export const instant = false;

export async function generateViewport() {
  await connection();
  return documentViewport;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AppSansFont>
      <Suspense fallback={<DashboardLoading />}>
        <DashboardAuthGuard>
          <PasskeyEnrollmentPrompt />
          {children}
        </DashboardAuthGuard>
      </Suspense>
    </AppSansFont>
  );
}
