/** Normalize a variant-selection query key to its canonical form. */
export function normalizeProductSelectionParamKey(
  value: string | null | undefined
): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}
