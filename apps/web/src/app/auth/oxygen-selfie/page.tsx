import type { Metadata } from 'next';
import { OxygenPhoneContinuation } from '@/components/payments/oxygen/OxygenPhoneContinuation';
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
export const metadata: Metadata = {
  title: 'Continue selfie verification',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return (
    <OxygenPhoneContinuation selfieOrigins={readOxygenHostedOrigins().selfie} />
  );
}
