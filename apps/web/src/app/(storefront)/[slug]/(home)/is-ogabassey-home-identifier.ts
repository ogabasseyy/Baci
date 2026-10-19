import type { Metadata } from 'next';
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
import { buildStorefrontMetadataTitle } from '@/lib/storefront-metadata-title';
import { mergeStorefrontSmartAppBannerOther } from '@/lib/storefront-smart-app-banner-metadata';

export const OGABASSEY_DOMAIN_IDENTIFIER = new URL(OGABASSEY_URL).hostname;

export function isOgabasseyHomeIdentifier(slug: string): boolean {
  const normalizedSlug = slug.toLowerCase();
  return (
    normalizedSlug === OGABASSEY_TEMPLATE_ID ||
    normalizedSlug === OGABASSEY_DOMAIN_IDENTIFIER
  );
}

export function isOgabasseyCanonicalDomainSlug(slug: string): boolean {
  return slug.toLowerCase() === OGABASSEY_DOMAIN_IDENTIFIER;
}

export function getOgabasseyHomePathPrefix(slug: string): string {
  return isOgabasseyCanonicalDomainSlug(slug)
    ? ''
    : `/${OGABASSEY_TEMPLATE_ID}`;
}

export function buildOgabasseyStaticHomeMetadata(
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

export function buildStorefrontLanguageAlternates(
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
