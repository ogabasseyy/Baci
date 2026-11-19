import { generateSlug } from '@/lib/seo-utils';

export const NON_BRAND_PLACEHOLDER_KEYS = new Set([
  'gaming',
  'game',
  'generic',
  'unbranded',
  'other',
  'unknown',
  'no-brand',
  'n-a',
  'na',
  'generic-brand',
  'brand-generic',
  'unbranded-product',
  'other-brand',
  'unknown-brand',
]);

/**
 * Returns true if the brand or key is missing, empty, or matches a known non-brand placeholder.
 * Normalizes input via trimming and slugification so callers can pass either raw brand labels
 * (e.g. ' Gaming ', 'N/A', 'Generic Brand') or pre-slugified keys (e.g. 'gaming', 'na').
 * Also checks common prefix/suffix wrapper variants (e.g. 'unbranded-product', 'other-brand').
 */
export function isNonBrandPlaceholderKey(keyOrBrand?: string | null): boolean {
  if (!keyOrBrand) return true;
  const trimmed = keyOrBrand.trim();
  if (!trimmed) return true;

  const normalized = trimmed.replace(/[._/\\-]+/g, ' ');
  const slug = generateSlug(normalized);
  if (!slug) return true;

  if (NON_BRAND_PLACEHOLDER_KEYS.has(slug)) return true;

  const stripped = slug
    .replace(/^(brands?|products?)-/, '')
    .replace(/-(brands?|products?)$/, '');

  return NON_BRAND_PLACEHOLDER_KEYS.has(stripped);
}
