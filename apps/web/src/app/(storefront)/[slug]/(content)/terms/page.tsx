import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { JsonLd } from '@/components/seo/json-ld';
import { OgabasseyV2LegalDispute } from '@/components/storefront/ogabassey/pages/legal-dispute';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { buildStorefrontContentPageSchema } from '@/lib/build-storefront-content-page-schema';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildRequestScopedStoreUrl, buildStoreUrl } from '@/lib/store-url';
import { TermsPageClient } from '../pages/terms/terms-page-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    return { title: 'Terms of Service' };
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/terms`;
  const description = generateMetaDescription(
    `Terms of Service for ${merchant.business_name}. Read our terms and conditions.`
  );

  return {
    title: `Terms of Service | ${merchant.business_name}`,
    description,
    openGraph: {
      title: `Terms of Service | ${merchant.business_name}`,
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

export default function TermsPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <TermsPageContent params={params} />
    </Suspense>
  );
}

async function TermsPageContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const hasTermsContent = merchant.pages?.terms;
  const templateHasTermsPage =
    !!merchant.template_id &&
    merchant.template_id !== 'default' &&
    merchant.template_id !== 'puck';

  if (!hasTermsContent && !templateHasTermsPage) {
    notFound();
  }

  const baseUrl = buildRequestScopedStoreUrl(merchant, await headers());

  const termsSchema = buildStorefrontContentPageSchema({
    baseUrl,
    businessName: merchant.business_name,
    description: `Terms of Service for ${merchant.business_name}.`,
    logoUrl: merchant.logo_url,
    pageName: 'Terms of Service',
    path: '/terms',
    updatedAt: merchant.updated_at,
  });

  const jsonLdScript = <JsonLd data={termsSchema} />;

  // Resolve template component server-side for SEO (H1 in SSR HTML).
  // Only the Ogabassey template defines a Terms page; import it directly so
  // this route's chunk carries exactly this page. JSX is constructed outside
  // any guard (try/catch cannot catch render errors anyway).
  if (templateHasTermsPage) {
    const TemplateTerms =
      merchant.template_id === OGABASSEY_TEMPLATE_ID
        ? OgabasseyV2LegalDispute
        : null;
    if (TemplateTerms) {
      return (
        <>
          {jsonLdScript}
          <TemplateTerms merchant={toTemplateMerchantData(merchant)} />
        </>
      );
    }
  }

  // Fallback to default terms page
  return (
    <>
      {jsonLdScript}
      <TermsPageClient merchant={merchant} content={merchant.pages?.terms} />
    </>
  );
}
