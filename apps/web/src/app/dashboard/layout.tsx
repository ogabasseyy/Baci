import { connection } from 'next/server';
import { type ReactNode, Suspense } from 'react';
import { AppSansFont } from '@/app/app-sans-font';
import { documentViewport } from '@/app/document-viewport';
import '@/app/globals.css';
import { PasskeyEnrollmentPrompt } from '@/components/passkey-enrollment-prompt';
import { DashboardAuthGuard } from './auth-guard';
import DashboardLoading from './loading';

// Allow the dashboard to block until its request-time viewport is ready.
// This trades the prerendered navigation shell for a document whose bootstrap
// scripts can all carry the request's CSP nonce.
export const instant = false;

export async function generateViewport() {
  // Viewport generation is part of the document head and cannot stream.
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
