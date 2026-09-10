import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getRepairDevicesForMerchant } from '@/lib/repairs/repairs-catalog-data';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { RepairsLabFallback } from './repairs-lab-fallback';
import {
  isCatalogEnabledForMerchant,
  RepairsPageContent,
  type RepairsPageRouteProps,
  shouldRenderRepairsPage,
} from './repairs-page-content';

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function getRepairsMerchant(slug: string) {
  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }

  const lookupKey = slug.toLowerCase();
  return isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);
}

export async function generateMetadata({
  params,
}: RepairsPageRouteProps): Promise<Metadata> {
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

async function RepairsPageResolved(props: RepairsPageRouteProps) {
  const { slug } = await props.params;
  const merchant = await getRepairsMerchant(slug);

  if (!merchant || !shouldRenderRepairsPage(merchant)) {
    notFound();
  }

  const groups = isCatalogEnabledForMerchant(merchant)
    ? await getRepairDevicesForMerchant(merchant.id).catch((error) => {
        console.error('Error loading repair devices for storefront:', error);
        return [];
      })
    : undefined;

  return <RepairsPageContent groups={groups} merchant={merchant} {...props} />;
}

export default function RepairsPage(props: RepairsPageRouteProps) {
  return (
    <Suspense fallback={<RepairsLabFallback />}>
      <RepairsPageResolved {...props} />
    </Suspense>
  );
}
