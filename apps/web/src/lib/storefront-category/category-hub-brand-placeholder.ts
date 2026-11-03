export const NON_BRAND_PLACEHOLDER_KEYS = new Set([
  'gaming',
  'generic',
  'unbranded',
  'other',
  'unknown',
  'no-brand',
  'n-a',
  'na',
  'generic-brand',
]);

/**
 * Returns true if the key is missing, empty, or matches a known non-brand placeholder slug.
 * Used across category hub brand cards, category hub brand utils, and compare eligibility.
 */
export function isNonBrandPlaceholderKey(key?: string | null): boolean {
  if (!key) return true;
  return NON_BRAND_PLACEHOLDER_KEYS.has(key);
}
