import { connection } from 'next/server';
import { OxygenPhoneContinuation } from '@/components/payments/oxygen/OxygenPhoneContinuation';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';

// Reads the selfie origins at request time. The page must render this
// inside a Suspense boundary: awaiting connection() at the top of the page
// makes `next build` fail to prerender the route.
export async function SelfieContinuation() {
  await connection();
  return (
    <OxygenPhoneContinuation selfieOrigins={readOxygenHostedOrigins().selfie} />
  );
}
