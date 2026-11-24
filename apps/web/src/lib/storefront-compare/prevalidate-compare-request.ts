import {
  evaluateStorefrontSlugSafety,
  MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH,
} from '@/lib/storefront-slug-safety';
import { isValidMerchantIdentifier } from '@/lib/validation';
import { type ParsedCompareSlug, parseCompareSlug } from './compare-slugs';
import { isSelfComparePair } from './is-self-compare-pair';

export const MAX_SAFE_COMPARE_SLUG_ENCODED_LENGTH =
  MAX_SAFE_STOREFRONT_SLUG_ENCODED_LENGTH * 2 + 4;

const DISALLOWED_COMPARE_SLUG_CHARS_PATTERN = /[\s\\/?#%]|\.\./;

export interface CompareRequestPrevalidationMiss {
  merchantSlug: string;
  categorySlug: string;
  comparisonSlug: string;
  reason:
    | 'unsafe_slug'
    | 'unsafe_compare_key'
    | 'invalid_compare_slug'
    | 'self_compare_pair';
}

export function hasDisallowedCompareSlugChars(value: string): boolean {
  if (DISALLOWED_COMPARE_SLUG_CHARS_PATTERN.test(value)) {
    return true;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function prevalidateCompareRequest(
  args: {
    merchantSlug: string;
    categorySlug: string;
    comparisonSlug: string;
  },
  onMiss?: (details: CompareRequestPrevalidationMiss) => void
): ParsedCompareSlug | null {
  if (!isValidMerchantIdentifier(args.merchantSlug)) {
    return null;
  }

  // Over-long / repeatedly-encoded bot categories can never match; bail before
  // any DB or `'use cache'` lookup runs.
  if (
    !evaluateStorefrontSlugSafety(args.categorySlug).safe ||
    hasDisallowedCompareSlugChars(args.categorySlug)
  ) {
    onMiss?.({
      merchantSlug: args.merchantSlug.slice(0, 120),
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'unsafe_slug',
    });
    return null;
  }

  if (
    !args.comparisonSlug ||
    args.comparisonSlug.length > MAX_SAFE_COMPARE_SLUG_ENCODED_LENGTH
  ) {
    onMiss?.({
      merchantSlug: args.merchantSlug.slice(0, 120),
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'unsafe_compare_key',
    });
    return null;
  }

  const parsed = parseCompareSlug(args.comparisonSlug);

  if (!parsed) {
    onMiss?.({
      merchantSlug: args.merchantSlug.slice(0, 120),
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'invalid_compare_slug',
    });
    return null;
  }

  // Gate the parsed halves (each a single product slug) before either reaches
  // getMerchantByIdentifier / getCachedProductWithDetails (`'use cache'`) or
  // becomes part of the cached compare model key.
  if (
    !evaluateStorefrontSlugSafety(parsed.leftKey).safe ||
    !evaluateStorefrontSlugSafety(parsed.rightKey).safe ||
    hasDisallowedCompareSlugChars(parsed.leftKey) ||
    hasDisallowedCompareSlugChars(parsed.rightKey)
  ) {
    onMiss?.({
      merchantSlug: args.merchantSlug.slice(0, 120),
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'unsafe_compare_key',
    });
    return null;
  }

  // This is the only missing-pair outcome known from the URL alone. Alias
  // equivalence requires inventory/detail authority, so do not reject merely
  // similar or canonicalized keys before the normal resolution path.
  if (isSelfComparePair(parsed)) {
    onMiss?.({
      merchantSlug: args.merchantSlug.slice(0, 120),
      categorySlug: args.categorySlug.slice(0, 120),
      comparisonSlug: args.comparisonSlug.slice(0, 120),
      reason: 'self_compare_pair',
    });
    return null;
  }

  return parsed;
}
