export const NON_BRAND_PLACEHOLDER_KEYS = new Set([
  'gaming',
  'generic',
  'unbranded',
  'other',
]);

export function isNonBrandPlaceholderKey(key?: string | null): boolean {
  if (!key) return true;
  return NON_BRAND_PLACEHOLDER_KEYS.has(key);
}
