import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Graph, Thing } from 'schema-dts';
import { JsonLd } from '@/components/seo/json-ld';
import { loadUnpublishedStorefront } from '@/components/storefront/unpublished-storefront';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import type { JsonLdStructuredData } from '@/lib/json-ld-types';
import {
  generateLocalBusinessSchema,
  generateOrganizationSchema,
  generateWebSiteSchema,
  type LocalBusinessData,
  type OrganizationData,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { buildMerchantTrustProfile } from '@/lib/storefront-trust/build-merchant-trust-profile';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { StorefrontContent } from './storefront-content';

export async function StorefrontPageContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const headersList = await headers();
  const originalPathname = headersList.get('x-pathname') || '/';
  const isHomepage =
    originalPathname === '/' || originalPathname === `/${slug}`;

  if (!isHomepage) {
    notFound();
  }

  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const isDevelopment = process.env.NODE_ENV === 'development';
  if (!merchant.is_published && !isDevelopment) {
    const StoreNotPublished = await loadUnpublishedStorefront();

    return <StoreNotPublished businessName={merchant.business_name} />;
  }

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
  const searchUrlTemplate = `${baseUrl}/search?q={search_term_string}`;
  const webSiteSchema = generateWebSiteSchema(
    merchant.business_name,
    baseUrl,
    searchUrlTemplate
  );

  const storefrontGraphSchema: Graph | null =
    localBusinessSchema || webSiteSchema
      ? {
          '@context': 'https://schema.org',
          '@graph': [organizationSchema, localBusinessSchema, webSiteSchema]
            .filter((schema): schema is JsonLdStructuredData => Boolean(schema))
            .map((schema) => {
              const { '@context': _, ...rest } = schema;
              return rest as Thing;
            }),
        }
      : null;

  return (
    <>
      {storefrontGraphSchema && <JsonLd data={storefrontGraphSchema} />}

      <StorefrontContent merchant={merchant} />
    </>
  );
}
