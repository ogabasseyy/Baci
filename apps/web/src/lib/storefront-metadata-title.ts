import type { Metadata } from 'next';
import { generateMetaTitle } from '@/lib/seo-utils';

const ELLIPSIS = '...';
const ELLIPSIS_LENGTH = ELLIPSIS.length;
const STOREFRONT_SERP_TITLE_MAX_LENGTH = 60;

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const rawSlice = value.slice(0, maxLength);
  if (/\s/.test(value[maxLength] ?? '')) {
    return rawSlice.replace(/[\s,;:|\-–—]+$/, '') || rawSlice;
  }
  const lastSpaceIndex = rawSlice.lastIndexOf(' ');
  const candidate =
    lastSpaceIndex >= Math.floor(maxLength * 0.5)
      ? rawSlice.slice(0, lastSpaceIndex)
      : rawSlice;
  return candidate.replace(/[\s,;:|\-–—]+$/, '') || rawSlice;
}

function applyWordBoundaryMaxLength(
  normalizedTitle: string,
  maxLength: number,
  suffix?: string
): string {
  if (
    !Number.isFinite(maxLength) ||
    maxLength <= ELLIPSIS_LENGTH ||
    normalizedTitle.length <= maxLength
  ) {
    return normalizedTitle;
  }

  const normalizedSuffix = suffix
    ? generateMetaTitle(suffix, { maxLength: Number.POSITIVE_INFINITY })
    : '';
  if (normalizedSuffix) {
    const suffixFragment = ` | ${normalizedSuffix}`;
    if (normalizedTitle.endsWith(suffixFragment)) {
      const baseTitle = normalizedTitle
        .slice(0, normalizedTitle.length - suffixFragment.length)
        .trim();
      const allowedBaseLength =
        maxLength - suffixFragment.length - ELLIPSIS_LENGTH;

      if (allowedBaseLength > 0) {
        return `${truncateAtWordBoundary(baseTitle, allowedBaseLength)}${ELLIPSIS}${suffixFragment}`;
      }
    }
  }

  return `${truncateAtWordBoundary(normalizedTitle, maxLength - ELLIPSIS_LENGTH)}${ELLIPSIS}`;
}

/**
 * Builds a storefront page title that is safe for SERP display, truncates at
 * clean word boundaries, and is not re-suffixed by the platform root template.
 */
export function buildStorefrontMetadataTitle(input: {
  fallback?: string;
  maxLength?: number;
  suffix?: string;
  title: string;
}): { metadataTitle: NonNullable<Metadata['title']>; title: string } {
  const maxLength = input.maxLength ?? STOREFRONT_SERP_TITLE_MAX_LENGTH;
  const fullTitle = generateMetaTitle(input.title, {
    fallback: input.fallback,
    maxLength: Number.POSITIVE_INFINITY,
    suffix: input.suffix,
  });
  const title = applyWordBoundaryMaxLength(fullTitle, maxLength, input.suffix);

  return {
    metadataTitle: { absolute: title },
    title,
  };
}
