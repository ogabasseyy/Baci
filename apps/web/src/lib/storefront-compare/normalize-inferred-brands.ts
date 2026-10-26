import { generateSlug } from '../seo-utils';
import { resolveCanonicalBrandKey } from './resolve-canonical-brand-key';

export function normalizeInferredBrands(
  categorySlug: string,
  inferredBrands?: string[]
): string[] {
  // Generic category tokens (e.g. `gaming` for the Gaming category) are
  // inferred as brand tokens by the content config but are not brands.
  const categoryKey = generateSlug(categorySlug);
  return Array.from(
    new Set(
      (inferredBrands ?? [])
        .map((brand) => resolveCanonicalBrandKey(categorySlug, brand))
        .filter((brand) => Boolean(brand) && brand !== categoryKey)
    )
  );
}
