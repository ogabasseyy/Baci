import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SelfieContinuation } from './SelfieContinuation';
export const metadata: Metadata = {
  title: 'Continue selfie verification',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SelfieContinuation />
    </Suspense>
  );
}
