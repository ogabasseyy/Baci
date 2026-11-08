import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { JsonLd } from '@/components/seo/json-ld';
import { applyApprovedPolicyFaqs } from '@/components/storefront/ogabassey/pages/approved-policy-faq';
import { OgabasseyV2HelpSupport } from '@/components/storefront/ogabassey/pages/help-support';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  getMerchantByIdentifier,
  getRequestScopedMerchant,
} from '@/lib/cached-data';
import { extractFaqItems } from '@/lib/extract-faq-items';
import { hasPublishableFaqContent } from '@/lib/has-publishable-faq-content';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { generateFAQSchema, getIndexableRobotsMetadata } from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { ContentPageCrawlSummary } from '../content-page-crawl-summary';
import { FAQPageClient } from '../pages/faq/faq-page-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const canonicalUrl = `${buildStoreUrl(merchant)}/faq`;

  return {
    title: 'FAQ',
    description: `Frequently asked questions about ${merchant.business_name}.`,
    twitter: {
      card: 'summary',
      title: `FAQ | ${merchant.business_name}`,
      description: `Frequently asked questions about ${merchant.business_name}.`,
    },
    openGraph: {
      title: `FAQ | ${merchant.business_name}`,
      description: `Find answers to common questions about ${merchant.business_name}.`,
      type: 'website',
      url: canonicalUrl,
      ...(merchant.logo_url && { images: [{ url: merchant.logo_url }] }),
    },
    alternates: {
      canonical: canonicalUrl,
    },
    robots: hasPublishableFaqContent(merchant)
      ? getIndexableRobotsMetadata()
      : { index: false, follow: true },
  };
}

/** Streams FAQ JSON-LD separately while the visible page content loads. */
export default function FAQPage({ params }: PageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <FAQJsonLd params={params} />
      </Suspense>
      <Suspense fallback={<ContentRouteLoading />}>
        <FAQContent params={params} />
      </Suspense>
    </>
  );
}

/** Streams FAQ JSON-LD structured data independently of page content. */
async function FAQJsonLd({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) return null;

  const faqItems = applyApprovedPolicyFaqs(
    extractFaqItems(merchant),
    merchant.slug
  );
  if (faqItems.length === 0) return null;

  const faqSchema = generateFAQSchema(faqItems);

  return <JsonLd data={faqSchema} />;
}

async function FAQContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  const faqItems = applyApprovedPolicyFaqs(
    extractFaqItems(merchant),
    merchant.slug
  );

  // Resolve template component server-side for SEO (H1 in SSR HTML).
  // Only the Ogabassey template defines a Help page; import it directly so
  // this route's chunk carries exactly this page. Construct JSX outside any
  // guard (try/catch cannot catch React rendering errors, and JSX inside a
  // try block prevents React Compiler optimization).
  const TemplateHelp =
    merchant.template_id === OGABASSEY_TEMPLATE_ID
      ? OgabasseyV2HelpSupport
      : null;
  if (TemplateHelp) {
    const merchantData = toTemplateMerchantData(merchant);
    return (
      <>
        <TemplateHelp merchant={merchantData} />
        <ContentPageCrawlSummary
          kind="faq"
          merchantName={merchant.business_name}
          businessType={merchant.business_type}
        />
      </>
    );
  }

  // Fallback to default FAQ page
  return (
    <FAQPageClient
      merchant={merchant}
      faqItems={faqItems}
      legacyContent={merchant.pages?.faq}
    >
      <ContentPageCrawlSummary
        kind="faq"
        merchantName={merchant.business_name}
        businessType={merchant.business_type}
      />
    </FAQPageClient>
  );
}
