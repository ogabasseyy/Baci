import type { Metadata } from 'next';
import { Suspense } from 'react';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { RepairsLabFallback } from './repairs-lab-fallback';
import {
  getRepairsMerchant,
  RepairsPageContent,
  type RepairsPageContentProps,
  shouldRenderRepairsPage,
} from './repairs-page-content';

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function generateMetadata({
  params,
}: RepairsPageContentProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getRepairsMerchant(slug);

  if (!merchant || !shouldRenderRepairsPage(merchant)) {
    return {
      title: 'Repair Service Not Found',
    };
  }

  const baseUrl = buildStoreUrl(merchant);

  return {
    title: buildStorefrontMetadataTitle({
      title: `Device Repairs - ${merchant.business_name}`,
      fallback: 'Device Repairs',
    }).metadataTitle,
    description: `Explore phone, laptop, and gadget repair services from ${merchant.business_name} with expert technicians and genuine parts.`,
    alternates: {
      canonical: `${baseUrl}/repairs`,
    },
  };
}

export default function RepairsPage(props: RepairsPageContentProps) {
  return (
    <Suspense fallback={<RepairsLabFallback />}>
      <RepairsPageContent {...props} />
    </Suspense>
  );
}
