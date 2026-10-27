import { CONTENT_CLUSTER_SUPPORT } from '../../config/storefront-content-clusters';
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
  if (matchingEntry) {
    return matchingEntry.brandKey;
  }
  // Content-config aliases (e.g. Sony -> playstation for gaming) sit
  // outside the authority taxonomy; resolve them so inferred content
  // brands match inventory brands in every category.
  const support =
    CONTENT_CLUSTER_SUPPORT[
      categorySlug as keyof typeof CONTENT_CLUSTER_SUPPORT
    ];
  if (support) {
    const rawSlug = generateSlug(raw);
    for (const [canonical, aliases] of Object.entries(support.brandTokens)) {
      if (
        generateSlug(canonical) === rawSlug ||
        aliases.some((alias: string) => generateSlug(alias) === rawSlug)
      ) {
        return generateSlug(canonical);
      }
    }
  }
  return generateSlug(raw);
}
