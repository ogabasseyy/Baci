import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContentRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { getMerchantByIdentifier } from '@/lib/cached-data';
import {
  generateMetaDescription,
  getIndexableRobotsMetadata,
} from '@/lib/seo-utils';
import { buildStoreUrl } from '@/lib/store-url';
import { ContactPageContent } from './contact-page-content';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const merchant = await getMerchantByIdentifier(slug);

  if (!merchant) {
    return { title: 'Contact Us' };
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/contact`;
  const description = generateMetaDescription(
    `Get in touch with ${merchant.business_name}. We're here to help.`
  );

  return {
    title: `Contact Us | ${merchant.business_name}`,
    description,
    openGraph: {
      title: `Contact ${merchant.business_name}`,
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

export default function ContactPage({ params }: PageProps) {
  return (
    <Suspense fallback={<ContentRouteLoading />}>
      <ContactPageContent params={params} />
    </Suspense>
  );
}
