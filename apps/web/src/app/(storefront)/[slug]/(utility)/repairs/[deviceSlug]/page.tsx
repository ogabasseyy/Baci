import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo/json-ld';
import { RepairDeviceDetailView } from '@/components/storefront/repairs/RepairDeviceDetailView';
import {
  type CachedMerchant,
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { getRepairDeviceDetailBySlug } from '@/lib/repairs/repairs-catalog-data';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import { buildRepairsDeviceSchema } from '@/lib/storefront-repairs/repairs-schema';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { repairsDeviceDetailRouteParamsSchema } from '@/schemas/repair-catalog';

interface RepairDeviceDetailPageProps {
  params: Promise<{ slug: string; deviceSlug: string }>;
}

const NOT_FOUND_METADATA: Metadata = { title: 'Repair Service Not Found' };

async function getRepairsMerchant(slug: string) {
  if (!isValidMerchantIdentifier(slug)) {
    return null;
  }

  const lookupKey = slug.toLowerCase();
  return isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);
}

function isCatalogEnabledForMerchant(merchant: CachedMerchant): boolean {
  return isRepairsCatalogEnabled({
    businessType: merchant.business_type,
    repairsCatalogEnabled: merchant.feature_settings?.repairs_catalog_enabled,
  });
}

/**
 * Validates the route params and resolves the merchant + device detail in
 * one place so both `generateMetadata` and the page component share the
 * exact same not-found conditions.
 */
async function resolveRepairDevicePage(slug: string, deviceSlug: string) {
  const parsedParams = repairsDeviceDetailRouteParamsSchema.safeParse({
    slug,
    deviceSlug,
  });
  if (!parsedParams.success) {
    return null;
  }

  const merchant = await getRepairsMerchant(parsedParams.data.slug);
  if (!merchant || !isCatalogEnabledForMerchant(merchant)) {
    return null;
  }

  const detail = await getRepairDeviceDetailBySlug(
    merchant.id,
    parsedParams.data.deviceSlug
  );
  if (!detail) {
    return null;
  }

  return { detail, merchant };
}

function buildDeviceMetaTitle(
  detail: NonNullable<Awaited<ReturnType<typeof resolveRepairDevicePage>>>
): { title: string; description: string } {
  const { detail: deviceDetail, merchant } = detail;
  const deviceLabel =
    `${deviceDetail.device.brand} ${deviceDetail.device.model}`.trim();
  const topServices = Array.from(
    new Set(deviceDetail.quotes.map((quote) => quote.serviceTypeName))
  ).slice(0, 3);
  const servicesText = topServices.join(', ');

  return {
    title: servicesText
      ? `Fix ${deviceLabel} — ${servicesText} | ${merchant.business_name}`
      : `Fix ${deviceLabel} | ${merchant.business_name}`,
    description: servicesText
      ? `Book a ${deviceLabel} repair with ${merchant.business_name}. Choose from ${servicesText} with transparent, up-front pricing.`
      : `Book a ${deviceLabel} repair with ${merchant.business_name}.`,
  };
}

export async function generateMetadata({
  params,
}: RepairDeviceDetailPageProps): Promise<Metadata> {
  const { slug, deviceSlug } = await params;
  const resolved = await resolveRepairDevicePage(slug, deviceSlug);
  if (!resolved) {
    return NOT_FOUND_METADATA;
  }

  const { title, description } = buildDeviceMetaTitle(resolved);
  const baseUrl = buildStoreUrl(resolved.merchant);
  const canonicalUrl = `${baseUrl}/repairs/${resolved.detail.device.slug}`;
  const { metadataTitle, title: resolvedTitle } = buildStorefrontMetadataTitle({
    fallback: `Fix ${resolved.detail.device.brand} ${resolved.detail.device.model}`,
    title,
  });
  const imageCandidates = [
    resolved.detail.device.imageUrl,
    resolved.merchant.logo_url,
  ];

  return {
    title: metadataTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: resolvedTitle,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: resolved.merchant.business_name,
      images: getStorefrontOpenGraphImages(
        baseUrl,
        resolvedTitle,
        ...imageCandidates
      ),
    },
    twitter: {
      card: 'summary_large_image',
      title: resolvedTitle,
      description,
      images: getStorefrontTwitterImages(baseUrl, ...imageCandidates),
    },
  };
}

export default async function RepairDeviceDetailPage({
  params,
}: RepairDeviceDetailPageProps) {
  const { slug, deviceSlug } = await params;
  const resolved = await resolveRepairDevicePage(slug, deviceSlug);
  if (!resolved) {
    notFound();
  }

  const { detail, merchant } = resolved;
  const baseUrl = buildStoreUrl(merchant);
  const repairsUrl = `${baseUrl}/repairs`;
  const deviceUrl = `${repairsUrl}/${detail.device.slug}`;
  const deviceLabel = `${detail.device.brand} ${detail.device.model}`.trim();
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: 'Repairs', url: repairsUrl },
    { name: deviceLabel, url: deviceUrl },
  ]);
  // Additive OfferCatalog of repair Service nodes linked (via isRelatedTo) to
  // the device's Product page. Null when the device has no active quotes.
  const deviceRepairSchema = buildRepairsDeviceSchema({
    areaServed: merchant.country,
    currency: merchant.payout_currency || 'NGN',
    detail,
    deviceUrl,
    merchantName: merchant.business_name,
    storeBaseUrl: baseUrl,
  });
  const basePath = getStorefrontPathPrefix(await headers(), merchant);

  return (
    <>
      <JsonLd data={breadcrumbSchema} />
      {deviceRepairSchema && <JsonLd data={deviceRepairSchema} />}
      <RepairDeviceDetailView
        basePath={basePath}
        currency={merchant.payout_currency || 'NGN'}
        detail={detail}
      />
    </>
  );
}
