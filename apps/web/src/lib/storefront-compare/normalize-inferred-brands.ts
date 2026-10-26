import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export function normalizeInferredBrands(
  categorySlug: string,
  inferredBrands?: string[]
): string[] {
  return Array.from(
    new Set(
      (inferredBrands ?? [])
        .map((brand) => resolveCanonicalBrandKey(categorySlug, brand))
        .filter(Boolean)
    )
  );
}
