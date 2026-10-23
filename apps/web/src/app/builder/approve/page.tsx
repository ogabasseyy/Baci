import type { Metadata } from 'next';
import { Suspense } from 'react';
import { loadInitialPublicationApproval } from '@/lib/website-builder/owner-publication-view';
import { ApprovalClient } from './approval-client';
export const metadata: Metadata = {
  title: 'Review homepage publication | Baci',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};
async function ApprovalContent({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const params = await searchParams;
  const intentId = params.intent ?? '';
  const initial = await loadInitialPublicationApproval(intentId);
  return (
    <ApprovalClient key={intentId} intentId={intentId} initial={initial} />
  );
}
export default function ApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  return (
    <Suspense fallback={<p role="status">Loading publication approval…</p>}>
      <ApprovalContent searchParams={searchParams} />
    </Suspense>
  );
}
