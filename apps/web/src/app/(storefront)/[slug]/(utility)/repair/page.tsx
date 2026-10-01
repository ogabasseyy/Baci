import type { Metadata } from 'next';
import { Suspense } from 'react';
import type { RepairBookingPreselection } from '@/components/storefront/RepairBookingWizard';
import {
  type CachedMerchant,
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getRepairDeviceDetailBySlug } from '@/lib/repairs/repairs-catalog-data';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { repairBookingSearchParamsSchema } from '@/schemas/repair-actions';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { RepairBookingFallback } from './repair-booking-fallback';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';
import type { RepairPageRouteProps } from './repair-page-content';

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function getRepairMerchant(slug: string) {
  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }

  const lookupKey = slug.toLowerCase();
  return isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);
}

async function resolveBookingPreselection(
  merchant: CachedMerchant,
  searchParams: { device?: string; quote?: string }
): Promise<RepairBookingPreselection | undefined> {
  if (
    !isRepairsCatalogEnabled({
      businessType: merchant.business_type,
      repairsCatalogEnabled: merchant.feature_settings?.repairs_catalog_enabled,
    })
  ) {
    return undefined;
  }

  const parsedParams = repairBookingSearchParamsSchema.safeParse(searchParams);
  if (!parsedParams.success || !parsedParams.data.device) {
    return undefined;
  }

  const detail = await getRepairDeviceDetailBySlug(
    merchant.id,
    parsedParams.data.device
  );
  if (!detail) {
    return undefined;
  }

  const matchedQuote = parsedParams.data.quote
    ? detail.quotes.find((quote) => quote.id === parsedParams.data.quote)
    : undefined;

  return {
    deviceId: detail.device.id,
    deviceLabel: `${detail.device.brand} ${detail.device.model}`.trim(),
    deviceSlug: detail.device.slug,
    deviceType: detail.device.deviceType,
    isFromPrice: matchedQuote?.isFromPrice,
    quoteId: matchedQuote?.id,
    quoteLabel: matchedQuote?.serviceTypeName,
    quotePrice: matchedQuote?.price,
  };
}

export async function generateMetadata({
  params,
}: RepairPageRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getRepairMerchant(slug);
  const { canUseRepairBooking } = await import('./repair-page-content');

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

export async function RepairPageResolved(props: RepairPageRouteProps) {
  const { slug } = await props.params;
  const merchant = await getRepairMerchant(slug);
  const { canUseRepairBooking, RepairPageContent } = await import(
    './repair-page-content'
  );
  const preselection = canUseRepairBooking(merchant)
    ? await resolveBookingPreselection(merchant, await props.searchParams)
    : undefined;

  return RepairPageContent({
    merchant,
    omitIntro: true,
    params: props.params,
    preselection,
    searchParams: props.searchParams,
  });
}

export default function RepairPage(props: RepairPageRouteProps) {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <RepairBookingLcpIntro />
        <Suspense fallback={<RepairBookingFallback hideIntro />}>
          <RepairPageResolved {...props} />
        </Suspense>
      </div>
    </div>
  );
}
