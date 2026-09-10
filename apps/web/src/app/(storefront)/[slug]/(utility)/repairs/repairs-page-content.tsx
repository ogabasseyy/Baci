import type { RepairDeviceBrandGroup } from '@baci/shared/repairs';
import { headers } from 'next/headers';
import { JsonLd } from '@/components/seo/json-ld';
import { OgabasseyV2Repairs } from '@/components/storefront/ogabassey/pages/repairs';
import { GenericRepairsPage } from '@/components/storefront/repairs/GenericRepairsPage';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import type { CachedMerchant } from '@/lib/cached-data';
import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { generateBreadcrumbSchema } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildRepairsIndexSchema } from '@/lib/storefront-repairs/repairs-schema';

export interface RepairsPageRouteProps {
  params: Promise<{ slug: string }>;
}

export interface RepairsPageContentProps extends RepairsPageRouteProps {
  groups?: RepairDeviceBrandGroup[];
  merchant: CachedMerchant;
}

function isOgabasseyMerchant(merchant: CachedMerchant): boolean {
  return merchant.template_id === OGABASSEY_TEMPLATE_ID;
}

export function isCatalogEnabledForMerchant(merchant: CachedMerchant): boolean {
  return isRepairsCatalogEnabled({
    businessType: merchant.business_type,
    repairsCatalogEnabled: merchant.feature_settings?.repairs_catalog_enabled,
  });
}

export function shouldRenderRepairsPage(merchant: CachedMerchant): boolean {
  return isOgabasseyMerchant(merchant) || isCatalogEnabledForMerchant(merchant);
}

function getRepairsBasePath(
  headersList: { get(name: string): string | null },
  merchant: { custom_domain?: string | null; slug: string }
): string {
  const requestMerchantSlug = headersList.get('x-merchant-slug')?.toLowerCase();
  const merchantSlug = merchant.slug.toLowerCase();
  const requestCustomDomain = headersList.get('x-custom-domain')?.toLowerCase();
  const merchantCustomDomain = merchant.custom_domain?.toLowerCase();
  const servedAtDomainRoot =
    requestMerchantSlug === merchantSlug ||
    (requestCustomDomain != null &&
      requestCustomDomain.length > 0 &&
      requestCustomDomain === merchantCustomDomain);

  return servedAtDomainRoot ? '' : `/${merchant.slug}`;
}

export async function RepairsPageContent({
  groups,
  merchant,
}: RepairsPageContentProps) {
  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/repairs`;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: merchant.business_name || 'Home', url: baseUrl },
    { name: 'Repairs', url: canonicalUrl },
  ]);
  const basePath = getRepairsBasePath(await headers(), merchant);
  const repairsIndexSchema = groups?.length
    ? buildRepairsIndexSchema({
        groups,
        merchantName: merchant.business_name,
        repairsUrl: canonicalUrl,
        storeBaseUrl: baseUrl,
      })
    : null;

  return (
    <>
      <JsonLd data={breadcrumbSchema} />
      {repairsIndexSchema && <JsonLd data={repairsIndexSchema} />}
      {isOgabasseyMerchant(merchant) ? (
        <OgabasseyV2Repairs basePath={basePath} groups={groups} />
      ) : (
        <GenericRepairsPage
          basePath={basePath}
          groups={groups ?? []}
          merchantName={merchant.business_name}
        />
      )}
    </>
  );
}
