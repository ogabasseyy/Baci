import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { OxygenPhoneContinuation } from '@/components/payments/oxygen/OxygenPhoneContinuation';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
export const metadata: Metadata = {
  title: 'Continue selfie verification',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

// Reads the selfie origins at request time. It must stay inside the
// Suspense boundary below: awaiting connection() at the top of the page
// makes `next build` fail to prerender this route.
export async function SelfieContinuation() {
  await connection();
  return (
    <OxygenPhoneContinuation selfieOrigins={readOxygenHostedOrigins().selfie} />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SelfieContinuation />
    </Suspense>
  );
}
