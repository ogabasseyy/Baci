import type { Metadata } from 'next';
import { Suspense } from 'react';
import {
  OGABASSEY_APPLE_TOUCH_ICON_URL,
  OGABASSEY_DESCRIPTION,
  OGABASSEY_FAVICON_URL,
  OGABASSEY_SOCIAL_IMAGE_URL,
  OGABASSEY_TITLE,
  OGABASSEY_TWITTER_HANDLE,
  OGABASSEY_URL,
} from '@/config/ogabassey';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import { getBrandMatchedTwitterHandle } from '@/lib/brand-matched-twitter-handle';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { buildFactualStorefrontDescription } from '@/lib/storefront-seo/build-factual-storefront-description';
import { buildHomeSeoDecision } from '@/lib/storefront-seo/build-home-seo-decision';
import { toNextRobotsMetadata } from '@/lib/storefront-seo/to-next-robots-metadata';
import { mergeStorefrontSmartAppBannerOther } from '@/lib/storefront-smart-app-banner-metadata';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

const OGABASSEY_DOMAIN_IDENTIFIER = new URL(OGABASSEY_URL).hostname;

export function generateStaticParams(): Array<{ slug: string }> {
  return [OGABASSEY_DOMAIN_IDENTIFIER, OGABASSEY_TEMPLATE_ID].map((slug) => ({
    slug,
  }));
}

function getOgabasseyHomePathPrefix(slug: string): string {
  return slug.toLowerCase() === OGABASSEY_DOMAIN_IDENTIFIER
    ? ''
    : `/${OGABASSEY_TEMPLATE_ID}`;
}

async function renderGenericStorefrontHomePage(
  params: Promise<{ slug: string }>
) {
  const { GenericStorefrontHomePage } = await import(
    './generic-storefront-home-page'
  );

  return <GenericStorefrontHomePage params={params} />;
}

async function renderOgabasseyStaticHomePage(slug: string) {
  const { OgabasseyStaticHomePage } = await import(
    './ogabassey-static-home-page'
  );

  return (
    <OgabasseyStaticHomePage pathPrefix={getOgabasseyHomePathPrefix(slug)} />
  );
}

function buildOgabasseyStaticHomeMetadata(
  robots: Metadata['robots']
): Metadata {
  const other = mergeStorefrontSmartAppBannerOther(OGABASSEY_TEMPLATE_ID);
  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    fallback: 'OgaBassey',
    title: OGABASSEY_TITLE,
  });

  return {
    metadataBase: new URL(OGABASSEY_URL),
    title: metadataTitle,
    description: OGABASSEY_DESCRIPTION,
    robots,
    keywords: [
      'Showmax Subscription',
      'Buy Showmax Online',
      'Cheap Airtime',
      'Buy Data Bundle',
      'Pay Electricity Bill',
      'Utility Payment',
      'OgaBassey',
      'Online Shopping',
      'Nigeria',
    ],
    alternates: {
      canonical: OGABASSEY_URL,
      languages: {
        'en-NG': OGABASSEY_URL,
        'x-default': OGABASSEY_URL,
      },
    },
    openGraph: {
      title,
      description: OGABASSEY_DESCRIPTION,
      url: OGABASSEY_URL,
      type: 'website',
      siteName: 'OgaBassey',
      images: [
        {
          url: OGABASSEY_SOCIAL_IMAGE_URL,
          width: 1440,
          height: 900,
          alt: 'OgaBassey storefront preview',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: OGABASSEY_DESCRIPTION,
      images: [OGABASSEY_SOCIAL_IMAGE_URL],
      site: OGABASSEY_TWITTER_HANDLE,
    },
    icons: {
      icon: OGABASSEY_FAVICON_URL,
      shortcut: OGABASSEY_FAVICON_URL,
      apple: OGABASSEY_APPLE_TOUCH_ICON_URL,
    },
    ...(other ? { other } : {}),
    manifest: null,
  };
}

function buildStorefrontLanguageAlternates(
  baseUrl: string,
  country: string | null | undefined
): Record<string, string> {
  const languages: Record<string, string> = {
    'x-default': baseUrl,
  };

  if (country?.trim().toUpperCase() === 'NG') {
    languages['en-NG'] = baseUrl;
  }

  return languages;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  if (isOgabasseyHomeIdentifier(slug)) {
    const merchant = await getRequestScopedMerchant(slug);
    const robots = toNextRobotsMetadata(
      buildHomeSeoDecision({
        isPublished: merchant?.is_published === true,
        canonicalUrl: OGABASSEY_URL,
        merchantName: merchant?.business_name ?? null,
      })
    );

    return buildOgabasseyStaticHomeMetadata(robots);
  }

  // Skip database query for invalid identifiers (like static asset requests)
  if (!isValidMerchantIdentifier(slug)) {
    return {
      title: 'Not Found',
      description: 'The page you are looking for does not exist.',
    };
  }

  // Use request-scoped lookup (deduplicates with layout, retries on transient errors)
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return {
      title: 'Store Not Found',
      description: 'The store you are looking for does not exist.',
    };
  }

  const { metadataTitle, title } = buildStorefrontMetadataTitle({
    title:
      merchant.site_title?.trim() ||
      (merchant.business_name
        ? `${merchant.business_name} - Official Online Store`
        : 'Official Online Store'),
    fallback: 'Official Online Store',
  });
  const baseUrl = buildStoreUrl(merchant);
  const description = buildFactualStorefrontDescription({
    businessName: merchant.business_name,
    siteDescription: merchant.site_description,
    siteTagline: merchant.site_tagline,
    categoryName: null,
    country: merchant.country,
  });
  const robots = toNextRobotsMetadata(
    buildHomeSeoDecision({
      isPublished: merchant.is_published === true,
      canonicalUrl: baseUrl,
      merchantName: merchant.business_name ?? null,
    })
  );

  const socialMedia = merchant.social_media as Record<string, string> | null;
  const twitterHandle = getBrandMatchedTwitterHandle(
    merchant.business_name,
    socialMedia?.twitter
  );

  return {
    metadataBase: new URL(baseUrl),
    title: metadataTitle,
    description: description,
    alternates: {
      canonical: baseUrl,
      languages: buildStorefrontLanguageAlternates(baseUrl, merchant.country),
    },
    robots,
    openGraph: {
      title: title,
      description: description,
      url: baseUrl,
      type: 'website',
      siteName: merchant.business_name,
      ...(merchant.logo_url && {
        images: [
          { url: merchant.logo_url, alt: `${merchant.business_name} logo` },
        ],
      }),
    },
    twitter: {
      card: 'summary_large_image',
      title: title,
      description: description,
      ...(merchant.logo_url && { images: [merchant.logo_url] }),
      ...(twitterHandle && {
        site: twitterHandle,
      }),
    },
    // Dynamic Favicon Support
    icons: {
      icon:
        merchant.favicon_svg_url ||
        merchant.favicon_png_32_url ||
        '/favicon.ico',
      shortcut: merchant.favicon_png_32_url || '/favicon.ico',
      apple: merchant.favicon_apple_touch_url || '/favicon.ico',
    },
  };
}

async function StorefrontHomeRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return isOgabasseyHomeIdentifier(slug)
    ? renderOgabasseyStaticHomePage(slug)
    : renderGenericStorefrontHomePage(params);
}

export default function StorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <>
      <OgabasseyHomeCommittedLcp params={params} />
      <Suspense fallback={null}>
        <StorefrontHomeRoute params={params} />
      </Suspense>
    </>
  );
}
