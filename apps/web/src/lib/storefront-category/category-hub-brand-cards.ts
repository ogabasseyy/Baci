import { CATEGORY_HUB_DEFAULTS } from '@/config/category-hub-defaults';
import { generateSlug } from '@/lib/seo-utils';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import { countBrandsByActiveProduct } from '@/lib/storefront-category/category-hub-brand-utils';
import type {
  BrandAuthorityEntry,
  CategoryHubCard,
  CategoryHubProduct,
} from '@/lib/storefront-category/category-hub-types';
import { buildBrandCompareCandidate } from '@/lib/storefront-compare/compare-eligibility';

const BRAND_CARD_FALLBACK_LIMIT = 5;

function pickFirstBrandProduct(
  products: CategoryHubProduct[],
  brand: string
): CategoryHubProduct | null {
  const brandProducts = products
    .filter(
      (product) =>
        generateSlug(product.brand?.trim() ?? '') === generateSlug(brand)
    )
    .sort(
      (left, right) =>
        left.price - right.price || left.name.localeCompare(right.name)
    );

  return brandProducts[0] ?? null;
}

export function buildCategoryHubBrandCards(input: {
  categorySlug: string;
  storeUrl: string;
  products: CategoryHubProduct[];
  brandAuthorityEntries?: Array<
    BrandAuthorityEntry & {
      productCount: number;
      productCountIsLowerBound?: boolean;
    }
  >;
}) {
  const priorityDefaults =
    CATEGORY_HUB_DEFAULTS[
      input.categorySlug as keyof typeof CATEGORY_HUB_DEFAULTS
    ];
  if (!priorityDefaults) {
    return [];
  }

  const sortedBrands = countBrandsByActiveProduct(input.products);
  const explicitAuthorityEntries = input.brandAuthorityEntries ?? [];
  const eligibleAuthorityEntries =
    explicitAuthorityEntries.length > 0
      ? explicitAuthorityEntries
      : brandAuthorityTaxonomy.getEligibleEntries(
          input.categorySlug,
          input.products
        );
  const authorityEntries = new Map(
    eligibleAuthorityEntries.map((entry) => [entry.brandKey, entry])
  );
  const authorityBrandKeys = new Set(
    eligibleAuthorityEntries.flatMap((entry) =>
      brandAuthorityTaxonomy
        .getBrandQueryValues(entry)
        .map((brand) => generateSlug(brand))
    )
  );
  const canonicalBrandCandidate = buildBrandCompareCandidate({
    categorySlug: input.categorySlug,
    products: input.products,
  });

  const displayedBrands =
    eligibleAuthorityEntries.length > 0
      ? [
          ...eligibleAuthorityEntries.map((entry) => ({
            key: entry.brandKey,
            label: entry.displayName,
            count: entry.productCount,
            countIsLowerBound:
              'productCountIsLowerBound' in entry
                ? (entry.productCountIsLowerBound ?? false)
                : false,
          })),
          ...sortedBrands
            .filter((entry) => !authorityBrandKeys.has(entry.key))
            .slice(
              0,
              Math.max(
                0,
                BRAND_CARD_FALLBACK_LIMIT - eligibleAuthorityEntries.length
              )
            ),
        ]
      : sortedBrands.slice(0, 3);

  return displayedBrands.flatMap((entry) => {
    const authorityEntry = authorityEntries.get(entry.key);
    const representative = authorityEntry
      ? null
      : pickFirstBrandProduct(input.products, entry.label);
    if (!authorityEntry && !representative) {
      return [];
    }
    const href = authorityEntry
      ? `${input.storeUrl}/${input.categorySlug}/brands/${entry.key}`
      : `${input.storeUrl}/${input.categorySlug}/${representative?.slug}`;

    const productCountLabel =
      'countIsLowerBound' in entry && entry.countIsLowerBound
        ? `${entry.count}+`
        : String(entry.count);
    const card: CategoryHubCard = {
      title: authorityEntry
        ? entry.label
        : (representative?.name ?? entry.label),
      description: authorityEntry
        ? `${productCountLabel} active ${entry.count === 1 ? 'product' : 'products'} ${explicitAuthorityEntries.length > 0 ? 'in this category' : 'on this page'}.`
        : `${entry.count} ${entry.label} ${entry.count === 1 ? 'product' : 'products'} on this page.`,
      href,
      eyebrow: authorityEntry
        ? priorityDefaults.brandHighlights.heading
        : `${entry.label} product pick`,
    };

    if (
      canonicalBrandCandidate?.isIndexable &&
      [canonicalBrandCandidate.leftBrand, canonicalBrandCandidate.rightBrand]
        .map((brand) => generateSlug(brand))
        .includes(generateSlug(entry.key))
    ) {
      card.secondaryHref = `${input.storeUrl}/${input.categorySlug}/compare/${canonicalBrandCandidate.canonicalSlug}`;
      card.secondaryLabel = `Compare ${canonicalBrandCandidate.leftBrand} vs ${canonicalBrandCandidate.rightBrand}`;
    }

    return [card];
  });
}
