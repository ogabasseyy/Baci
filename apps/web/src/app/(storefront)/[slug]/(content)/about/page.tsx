import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { OgabasseyV2AboutUs } from '@/components/storefront/ogabassey/pages/about-us';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import type { MerchantAboutPage } from '@/types/about-page';
import { ContentPageCrawlSummary } from '../content-page-crawl-summary';
import { AboutPageClient } from '../pages/about/about-page-client';
import { AboutJsonLd } from './about-json-ld';

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

  const aboutPage = (merchant.about_page || {}) as MerchantAboutPage;
  const legacyAboutContent = merchant.pages?.about;

  const description =
    aboutPage.story ||
    aboutPage.mission ||
    legacyAboutContent ||
    `Learn more about ${merchant.business_name}`;
  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/about`;
  const seoDescription = generateMetaDescription(description);

  return {
    title: `About Us | ${merchant.business_name}`,
    description: seoDescription,
    openGraph: {
      title: `About ${merchant.business_name}`,
      description: seoDescription,
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

/** Streams JSON-LD separately while the visible page content loads. */
export default function AboutPage({ params }: PageProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AboutJsonLd params={params} />
      </Suspense>
      <AboutContent params={params} />
    </>
  );
}

async function AboutContent({ params }: PageProps) {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    notFound();
  }

  const aboutPage = (merchant.about_page || {}) as MerchantAboutPage;
  const legacyAboutContent = merchant.pages?.about;

  // Resolve template component server-side for SEO (H1 in SSR HTML).
  // The component is imported directly (only the Ogabassey template defines
  // an About page), so there is no async module load to guard — construct
  // the data, JSX stays outside as before.
  const TemplateAbout =
    merchant.template_id === OGABASSEY_TEMPLATE_ID ? OgabasseyV2AboutUs : null;
  // Resolve the component data, but construct the JSX outside —
  // try/catch cannot catch React render errors.
  if (TemplateAbout) {
    const merchantData = toTemplateMerchantData(merchant);
    return (
      <>
        <TemplateAbout merchant={merchantData} />
        <ContentPageCrawlSummary
          kind="about"
          merchantName={merchant.business_name}
          businessType={merchant.business_type}
        />
      </>
    );
  }

  // Fallback to default about page
  return (
    <AboutPageClient
      merchant={merchant}
      aboutPage={aboutPage}
      legacyContent={legacyAboutContent}
    >
      <ContentPageCrawlSummary
        kind="about"
        merchantName={merchant.business_name}
        businessType={merchant.business_type}
      />
    </AboutPageClient>
  );
}
