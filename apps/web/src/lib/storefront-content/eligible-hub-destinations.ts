import { generateSlug } from '@/lib/seo-utils';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { isAvailableProduct } from './is-available-product';

export interface EligibleHubItem {
  href: string;
  label: string;
  category_slug?: string;
  brand_key?: string;
  family_key?: string;
  band_slug?: string;
  product_count?: number;
}

export interface EligibleHubProductInput {
  name: string;
  slug?: string;
  brand?: string | null;
  stock?: number | null;
  price?: number;
  category_slug?: string | null;
  category_slugs?: string[] | null;
  /** Legacy denormalized category text, matched via generateSlug. */
  category?: string | null;
  product_key_specs?: Record<string, unknown> | null;
  is_parent?: boolean | null;
  parent_product_id?: string | null;
  manage_stock?: boolean | null;
  availability?: 'InStock' | 'OutOfStock' | null;
}

export interface ResolveEligibleCategoryHubDestinationsInput {
  storeUrl?: string;
  categorySlug: string;
  products: EligibleHubProductInput[];
  /** Set only when the caller supplies an already category-scoped pool. */
  assumeCategoryScoped?: boolean;
}

export interface ResolvedEligibleCategoryHubDestinations {
  brandHubs: EligibleHubItem[];
  familyHubs: EligibleHubItem[];
}

/** PROVISIONAL eligibility from caller-supplied rows (raw stock) — not destination-verified. Callers must re-verify against destination inventory before emitting links (see verifyEligibleHubsAgainstDestination), unless the pool is destination-verified. */
export function resolveEligibleCategoryHubDestinations(
  input: ResolveEligibleCategoryHubDestinationsInput
): ResolvedEligibleCategoryHubDestinations {
  const baseUrl = input.storeUrl ? input.storeUrl.replace(/\/+$/, '') : '';
  const categorySlug = generateSlug(input.categorySlug);

  // Mirror the destination inventory scope: brand/family pages only count
  // parent or standalone rows (is_parent=true or no parent), never variants.
  const availableProducts = input.products.filter((product) => {
    const isAvailable =
      product.availability != null
        ? product.availability === 'InStock'
        : isAvailableProduct(product);

    return (
      isAvailable &&
      // Explicitly scoped pools are already category+children filtered by
      // the caller, so child-only rows count toward the parent hub.
      (input.assumeCategoryScoped === true ||
        generateSlug(product.category_slug ?? '') === categorySlug ||
        generateSlug(product.category ?? '') === categorySlug ||
        (product.category_slugs ?? []).some(
          (slug) => generateSlug(slug) === categorySlug
        )) &&
      (product.is_parent === true || product.parent_product_id == null)
    );
  });

  const eligibleBrandEntries = brandAuthorityTaxonomy.getEligibleEntries(
    categorySlug,
    availableProducts
  );

  const brandHubs: EligibleHubItem[] = [];
  const familyHubs: EligibleHubItem[] = [];

  for (const brandEntry of eligibleBrandEntries) {
    brandHubs.push({
      href: `${baseUrl}/${categorySlug}/brands/${brandEntry.brandKey}`,
      label: `Explore ${brandEntry.displayName}`,
      category_slug: categorySlug,
      brand_key: brandEntry.brandKey,
      product_count: brandEntry.productCount,
    });

    const familyEntries = modelFamilyAuthorityTaxonomy.getEntries(
      categorySlug,
      brandEntry.brandKey
    );

    const brandProducts = availableProducts.filter((product) =>
      brandAuthorityTaxonomy.matchesBrand(brandEntry, product.brand ?? null)
    );

    for (const familyEntry of familyEntries) {
      const matchingProducts = brandProducts.filter((product) =>
        modelFamilyAuthorityTaxonomy.matchesProduct(familyEntry, product.name)
      );

      if (matchingProducts.length >= familyEntry.minimumProducts) {
        familyHubs.push({
          href: `${baseUrl}/${categorySlug}/brands/${brandEntry.brandKey}/families/${familyEntry.familyKey}`,
          label: `Explore ${familyEntry.displayName}`,
          category_slug: categorySlug,
          brand_key: brandEntry.brandKey,
          family_key: familyEntry.familyKey,
          product_count: matchingProducts.length,
        });
      }
    }
  }

  return {
    brandHubs,
    familyHubs,
  };
}
