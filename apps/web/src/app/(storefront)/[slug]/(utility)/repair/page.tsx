import type { Metadata } from 'next';
import { Suspense } from 'react';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { RepairBookingFallback } from './repair-booking-fallback';
import {
  canUseRepairBooking,
  getRepairMerchant,
  RepairPageContent,
  type RepairPageContentProps,
} from './repair-page-content';

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function generateMetadata({
  params,
}: RepairPageContentProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getRepairMerchant(slug);

  if (!canUseRepairBooking(merchant)) {
    return {
      title: 'Store Not Found',
    };
  }

  const baseUrl = buildStoreUrl(merchant);

  return {
    title: buildStorefrontMetadataTitle({
      title: `Book a Repair - ${merchant.business_name}`,
      fallback: 'Book a Repair',
    }).metadataTitle,
    description: `Book phone, laptop, console and gadget repairs with ${merchant.business_name}. Check diagnosis, fault details, service expectations and support before submitting a repair request.`,
    alternates: {
      canonical: `${baseUrl}/repair`,
    },
  };
}

export default function RepairPage(props: RepairPageContentProps) {
  return (
    <Suspense fallback={<RepairBookingFallback />}>
      <RepairPageContent {...props} />
    </Suspense>
  );
}
