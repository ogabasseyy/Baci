import type { getRequestScopedMerchant } from '@/lib/cached-data';
import {
  generateLocalBusinessSchema,
  generateOrganizationSchema,
  generateWebSiteSchema,
  type LocalBusinessData,
  type OrganizationData,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';

export type OgabasseyMerchant = NonNullable<
  Awaited<ReturnType<typeof getRequestScopedMerchant>>
>;

/**
 * Sole export: the organization identity graph for the homepage JSON-LD.
 * Split from OgabasseyHomeDiscoverySection to honor the one-export-per-file
 * rule; the section awaits the category/launch legs and embeds this graph.
 */
export function buildOrganizationGraphSchema(merchant: OgabasseyMerchant) {
  const baseUrl = buildStoreUrl(merchant);
  const trustProfile = buildMerchantTrustProfile(merchant, baseUrl);
  const description =
    merchant.site_description ||
    merchant.site_tagline ||
    `Welcome to ${merchant.business_name}`;

  const businessData: LocalBusinessData = {
    name: merchant.business_name,
    description,
    url: baseUrl,
    logo: merchant.logo_url || undefined,
    telephone: merchant.phone || undefined,
    address: merchant.business_address
      ? {
          street: merchant.business_address,
          country: merchant.country || 'NG',
        }
      : undefined,
    socialMedia:
      Object.keys(trustProfile.socialLinks).length > 0
        ? trustProfile.socialLinks
        : undefined,
  };

  const organizationData: OrganizationData = {
    name: merchant.business_name,
    description,
    url: baseUrl,
    logo: merchant.logo_url || undefined,
    email: trustProfile.supportEmail || merchant.email || undefined,
    telephone: trustProfile.supportPhone || merchant.phone || undefined,
    country: merchant.country || 'NG',
    socialMedia:
      Object.keys(trustProfile.socialLinks).length > 0
        ? trustProfile.socialLinks
        : undefined,
    trustProfile,
  };

  const organizationSchema = generateOrganizationSchema(organizationData);
  const localBusinessSchema = merchant.business_address
    ? generateLocalBusinessSchema(businessData)
    : null;
  const webSiteSchema = generateWebSiteSchema(
    merchant.business_name,
    baseUrl,
    `${baseUrl}/search?q={search_term_string}`
  );

  return {
    '@context': 'https://schema.org',
    '@graph': [organizationSchema, localBusinessSchema, webSiteSchema]
      .filter(Boolean)
      .map((schema) => {
        const { '@context': _, ...rest } = schema as Record<string, unknown>;
        return rest;
      }),
  };
}
