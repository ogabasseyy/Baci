import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

const GENERIC_BRAND_KEYS = new Set(['gaming']);

export function normalizeInferredBrands(
  categorySlug: string,
  inferredBrands?: string[]
): string[] {
  // Generic tokens (e.g. `gaming`) are inferred as brand tokens by the
  // content config but are not brands. Genuine brands that share their
  // category slug (e.g. `xbox`) must be preserved.
  return Array.from(
    new Set(
      (inferredBrands ?? [])
        .map((brand) => resolveCanonicalBrandKey(categorySlug, brand))
        .filter((brand) => Boolean(brand) && !GENERIC_BRAND_KEYS.has(brand))
    )
  );
}
