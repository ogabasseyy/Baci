/** Deterministic public category title from a slug when DB name is absent. */
export function getCategoryFallbackName(categorySlug: string): string {
  let decodedSlug = categorySlug;
  try {
    decodedSlug = decodeURIComponent(categorySlug);
  } catch {
    // Keep fallback naming total for malformed inputs from internal callers.
  }

  return decodedSlug
    .replace(/-/g, ' ')
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}
