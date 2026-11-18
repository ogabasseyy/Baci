import type { Metadata } from 'next';
import { generateMetaTitle } from '@/lib/seo-utils';

const STOREFRONT_SERP_TITLE_MAX_LENGTH = 60;

/**
 * Builds a storefront page title that is safe for SERP display, truncates at
 * clean word boundaries, and is not re-suffixed by the platform root template.
 */
export function buildStorefrontMetadataTitle(input: {
  dropSuffixWhenTooLong?: boolean;
  fallback?: string;
  maxLength?: number;
  suffix?: string;
  title: string;
}): { metadataTitle: NonNullable<Metadata['title']>; title: string } {
  const title = generateMetaTitle(input.title, {
    dropSuffixWhenTooLong: input.dropSuffixWhenTooLong,
    fallback: input.fallback,
    maxLength: input.maxLength ?? STOREFRONT_SERP_TITLE_MAX_LENGTH,
    suffix: input.suffix,
  });

  return {
    metadataTitle: { absolute: title },
    title,
  };
}
