import type { Metadata } from 'next';
import { generateMetaTitle } from '@/lib/seo-utils';

const STOREFRONT_SERP_TITLE_MAX_LENGTH = 60;

/**
 * Builds a storefront page title that is safe for SERP display and not
 * re-suffixed by the platform-level root metadata template.
 */
export function buildStorefrontMetadataTitle(input: {
  /** Product titles: drop the brand suffix rather than cut the title. */
  dropSuffixWhenTooLong?: boolean;
  fallback?: string;
  maxLength?: number;
  suffix?: string;
  title: string;
}): {
  metadataTitle: NonNullable<Metadata['title']>;
  /** Open Graph / Twitter title: always keeps the brand suffix. */
  socialTitle: string;
  title: string;
} {
  const titleOptions = {
    fallback: input.fallback,
    maxLength: input.maxLength ?? STOREFRONT_SERP_TITLE_MAX_LENGTH,
    suffix: input.suffix,
  };
  const title = generateMetaTitle(input.title, {
    ...titleOptions,
    dropSuffixWhenTooLong: input.dropSuffixWhenTooLong,
  });
  // Shared links show the title without the site's name, so keep the merchant
  // suffix there even when the SERP title dropped it to fit the full name.
  const socialTitle = input.dropSuffixWhenTooLong
    ? generateMetaTitle(input.title, titleOptions)
    : title;

  return {
    metadataTitle: { absolute: title },
    socialTitle,
    title,
  };
}
