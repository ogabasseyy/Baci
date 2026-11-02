import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { DeviceAssuranceContent } from './device-assurance-content';

export const metadata: Metadata = {
  title: buildStorefrontMetadataTitle({
    title: 'Device Inspection Guide',
    fallback: 'Device Inspection Guide',
  }).metadataTitle,
  description:
    'A checklist for inspecting a phone or laptop, with links to store policies and the IMEI checker.',
};

export default function DeviceAssurancePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <DeviceAssuranceContent params={params} />
    </Suspense>
  );
}
