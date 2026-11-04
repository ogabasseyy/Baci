import type { Metadata } from 'next';
import { connection } from 'next/server';
import { OxygenPhoneContinuation } from '@/components/payments/oxygen/OxygenPhoneContinuation';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
export const metadata: Metadata = {
  title: 'Continue selfie verification',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function Page() {
  await connection();
  return (
    <OxygenPhoneContinuation selfieOrigins={readOxygenHostedOrigins().selfie} />
  );
}
