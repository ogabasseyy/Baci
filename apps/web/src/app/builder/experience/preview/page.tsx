import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrivatePreviewContent } from './preview-content';
export const metadata: Metadata = {
  title: 'Private full-code preview | Baci',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
export default function PrivatePreviewPage(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return (
    <Suspense
      fallback={
        <main>
          <h1>Loading preview</h1>
        </main>
      }
    >
      <PrivatePreviewContent {...props} />
    </Suspense>
  );
}
