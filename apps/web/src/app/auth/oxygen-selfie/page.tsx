import type { Metadata } from 'next';
import { OxygenPhoneContinuation } from '@/components/payments/oxygen/OxygenPhoneContinuation';
export const metadata: Metadata = {
  title: 'Continue selfie verification',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Page() {
  return <OxygenPhoneContinuation />;
}
