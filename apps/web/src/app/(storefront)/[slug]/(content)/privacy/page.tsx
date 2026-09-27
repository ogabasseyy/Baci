import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { JsonLd } from '@/components/seo/json-ld';
import { OgabasseyV2PrivacyPolicy } from '@/components/storefront/ogabassey/pages/privacy-policy';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { buildStorefrontContentPageSchema } from '@/lib/build-storefront-content-page-schema';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl, buildStoreUrl } from '@/lib/store-url';
import { PrivacyPageClient } from '../pages/privacy/privacy-page-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    return { title: 'Privacy Policy' };
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/privacy`;
  const description = generateMetaDescription(
    `Privacy Policy for ${merchant.business_name}. Learn how we collect, use, and protect your personal information.`
  );

  return {
    title: `Privacy Policy | ${merchant.business_name}`,
    description,
    openGraph: {
      title: `Privacy Policy | ${merchant.business_name}`,
      description,
      type: 'website',
      url: canonicalUrl,
      ...(merchant.logo_url && { images: [{ url: merchant.logo_url }] }),
    },
    alternates: {
      canonical: canonicalUrl,
    },
    robots: getIndexableRobotsMetadata(),
  };
}

export default function PrivacyPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <PrivacyPageContent params={params} />
    </Suspense>
  );
}

async function PrivacyPageContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const hasPrivacyContent = merchant.pages?.privacy;
  const templateHasPrivacyPage =
    !!merchant.template_id &&
    merchant.template_id !== 'default' &&
    merchant.template_id !== 'puck';

  if (!hasPrivacyContent && !templateHasPrivacyPage) {
    notFound();
  }

  const baseUrl = buildRequestScopedStoreUrl(merchant, await headers());

  const privacySchema = buildStorefrontContentPageSchema({
    baseUrl,
    businessName: merchant.business_name,
    description: `Privacy Policy for ${merchant.business_name}.`,
    logoUrl: merchant.logo_url,
    pageName: 'Privacy Policy',
    path: '/privacy',
    updatedAt: merchant.updated_at,
  });

  const jsonLdScript = <JsonLd data={privacySchema} />;

  // Resolve template component server-side for SEO (H1 in SSR HTML).
  // Only the Ogabassey template defines a Privacy page; import it directly
  // so this route's chunk carries exactly this page.
  if (templateHasPrivacyPage) {
    const TemplatePrivacy =
      merchant.template_id === OGABASSEY_TEMPLATE_ID
        ? OgabasseyV2PrivacyPolicy
        : null;

    if (TemplatePrivacy) {
      return (
        <>
          {jsonLdScript}
          <TemplatePrivacy merchant={toTemplateMerchantData(merchant)} />
        </>
      );
    }
  }

  // Fallback to default privacy page
  return (
    <>
      {jsonLdScript}
      <PrivacyPageClient
        merchant={merchant}
        content={merchant.pages?.privacy}
      />
    </>
  );
}
