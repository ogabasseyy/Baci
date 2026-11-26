import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ImeiCheckerHero } from '@/components/storefront/ogabassey/pages/imei-checker-hero';
import { OgabasseyImeiCheckerShell } from '@/components/storefront/ogabassey/pages/imei-checker-shell';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import {
  getStorefrontOpenGraphImages,
  getStorefrontTwitterImages,
} from '@/lib/storefront-social-images';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { getOgabasseyStaticParams } from '../../ogabassey-static-params';
import { ImeiCheckFallback } from './imei-check-fallback';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    return {
      title: 'Store Not Found',
    };
  }

  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (!merchant || merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    return {
      title: 'Store Not Found',
    };
  }

  const baseUrl = buildStoreUrl(merchant);
  const canonicalUrl = `${baseUrl}/imei-check`;
  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title: 'Free Phone IMEI Check & Verification',
    fallback: 'Free Phone IMEI Check & Verification',
  });
  const description =
    'Check phone IMEI status, review verification requirements, and confirm device identity before buying, swapping, repairing or reselling a phone.';

  return {
    title: metadataTitle,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'website',
      siteName: merchant.business_name,
      images: getStorefrontOpenGraphImages(baseUrl, title, merchant.logo_url),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: getStorefrontTwitterImages(baseUrl, merchant.logo_url),
    },
  };
}

export function generateStaticParams(): Array<{ slug: string }> {
  return getOgabasseyStaticParams();
}

export async function ImeiCheckResolvedContent({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (!merchant) {
    notFound();
  }

  if (merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    notFound();
  }

  const { ImeiCheckPageContent } = await import('./imei-check-page-content');

  return <ImeiCheckPageContent omitHero />;
}

export default function ImeiCheckPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <OgabasseyImeiCheckerShell>
      <ImeiCheckerHero />
      <Suspense fallback={<ImeiCheckFallback hideHero />}>
        <ImeiCheckResolvedContent params={params} />
      </Suspense>
    </OgabasseyImeiCheckerShell>
  );
}
