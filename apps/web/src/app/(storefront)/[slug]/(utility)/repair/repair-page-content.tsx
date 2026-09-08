import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import {
  type RepairBookingPreselection,
  RepairBookingWizard,
} from '@/components/storefront/RepairBookingWizard';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  type CachedMerchant,
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getRepairDeviceDetailBySlug } from '@/lib/repairs/repairs-catalog-data';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { repairBookingSearchParamsSchema } from '@/schemas/repair-actions';
import { RepairBookingLcpIntro } from './repair-booking-lcp-intro';

export interface RepairPageContentProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{ device?: string; quote?: string }>;
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

export function canUseRepairBooking(
  merchant: CachedMerchant | null
): merchant is CachedMerchant {
  if (!merchant) {
    return false;
  }

  return (
    merchant.template_id === OGABASSEY_TEMPLATE_ID ||
    isRepairsCatalogEnabled({
      businessType: merchant.business_type,
      repairsCatalogEnabled: merchant.feature_settings?.repairs_catalog_enabled,
    })
  );
}

export async function RepairPageContent({
  params,
  searchParams,
}: RepairPageContentProps) {
  const { slug } = await params;
  const merchant = await getRepairMerchant(slug);

  if (!canUseRepairBooking(merchant)) {
    notFound();
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/repair`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: 'Book a Repair', url: canonicalUrl },
  ]);
  const preselection = await resolveBookingPreselection(
    merchant,
    await searchParams
  );

  return (
    <div className="container mx-auto py-12 px-4">
      <JsonLd data={breadcrumbSchema} />
      <div className="max-w-3xl mx-auto">
        <RepairBookingLcpIntro />

        <div className="bg-store-background-text/5 border border-store-border rounded-xl shadow-sm overflow-hidden">
          <RepairBookingWizard
            merchantId={merchant.id}
            merchantSlug={slug}
            merchantName={merchant.business_name}
            preselection={preselection}
          />
        </div>
      </div>
    </div>
  );
}
