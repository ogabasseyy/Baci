import { generateSlug } from '../seo-utils';
import { brandAuthorityTaxonomy } from '../storefront-category/brand-authority-taxonomy';

export interface CommercialSupportBrandProduct {
  slug: string;
  name: string;
  price: number;
  brand?: string | null;
  category_slug?: string | null;
  product_key_specs?: Record<string, unknown> | null;
}

export function resolveCanonicalBrandKey(
  categorySlug: string,
  brand: string | null | undefined
): string {
  const raw = (brand ?? '').trim();
  if (!raw) {
    return '';
  }
  const matchingEntry = brandAuthorityTaxonomy
    .getEntries(categorySlug)
    .find((entry) => brandAuthorityTaxonomy.matchesBrand(entry, raw));
  return matchingEntry?.brandKey ?? generateSlug(raw);
}
