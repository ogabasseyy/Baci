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
}): { metadataTitle: NonNullable<Metadata['title']>; title: string } {
  const title = generateMetaTitle(input.title, {
    fallback: input.fallback,
    maxLength: input.maxLength ?? STOREFRONT_SERP_TITLE_MAX_LENGTH,
    suffix: input.suffix,
    dropSuffixWhenTooLong: input.dropSuffixWhenTooLong,
  });

  return {
    metadataTitle: { absolute: title },
    title,
  };
}
