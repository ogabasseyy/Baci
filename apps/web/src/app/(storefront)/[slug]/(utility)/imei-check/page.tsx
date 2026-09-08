import type { Metadata } from 'next';
import { Suspense } from 'react';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { ImeiCheckFallback } from './imei-check-fallback';
import { ImeiCheckPageContent } from './imei-check-page-content';

export const metadata: Metadata = {
  title: buildStorefrontMetadataTitle({
    title: 'IMEI Check',
    fallback: 'IMEI Check',
  }).metadataTitle,
  description:
    'Check phone IMEI status, review verification requirements, and confirm device identity before buying, swapping, repairing or reselling a phone.',
};

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export default function ImeiCheckPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<ImeiCheckFallback />}>
      <ImeiCheckPageContent params={params} />
    </Suspense>
  );
}
