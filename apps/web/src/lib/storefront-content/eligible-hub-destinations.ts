import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { modelFamilyAuthorityTaxonomy } from '@/lib/storefront-category/model-family-authority-taxonomy';
import { buildCategoryPriceBandCandidates } from '@/lib/storefront-compare/build-commercial-support-links';

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
  product_key_specs?: Record<string, unknown> | null;
}

export interface ResolveEligibleCategoryHubDestinationsInput {
  storeUrl?: string;
  categorySlug: string;
  products: EligibleHubProductInput[];
}

export interface ResolvedEligibleCategoryHubDestinations {
  brandHubs: EligibleHubItem[];
  familyHubs: EligibleHubItem[];
  priceBandHubs: EligibleHubItem[];
  brand_hubs: EligibleHubItem[];
  family_hubs: EligibleHubItem[];
  price_band_hubs: EligibleHubItem[];
}

export function resolveEligibleCategoryHubDestinations(
  input: ResolveEligibleCategoryHubDestinationsInput
): ResolvedEligibleCategoryHubDestinations {
  const baseUrl = input.storeUrl ? input.storeUrl.replace(/\/+$/, '') : '';
  const categorySlug = input.categorySlug;

  const availableProducts = input.products.filter(
    (product) =>
      (product.stock == null || product.stock > 0) &&
      (!product.category_slug || product.category_slug === categorySlug)
  );

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

  const priceBandHubs: EligibleHubItem[] = [];

  const priceBandProducts = availableProducts
    .filter(
      (p): p is EligibleHubProductInput & { price: number } =>
        p.price != null && p.price > 0
    )
    .map((p) => ({
      slug: p.slug ?? '',
      name: p.name,
      brand: p.brand,
      price: p.price,
      category_slug: p.category_slug ?? categorySlug,
      product_key_specs: p.product_key_specs ?? null,
    }));

  const eligiblePriceBands = buildCategoryPriceBandCandidates(
    categorySlug,
    priceBandProducts
  ).filter((candidate) => candidate.isIndexable);

  for (const candidate of eligiblePriceBands) {
    priceBandHubs.push({
      href: `${baseUrl}/${categorySlug}/best-under/${candidate.band.slug}`,
      label: candidate.band.label,
      category_slug: categorySlug,
      band_slug: candidate.band.slug,
    });
  }

  return {
    brandHubs,
    familyHubs,
    priceBandHubs,
    brand_hubs: brandHubs,
    family_hubs: familyHubs,
    price_band_hubs: priceBandHubs,
  };
}
