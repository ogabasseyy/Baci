import { formatCurrencyCompact } from '@/lib/currency';
import { formatVerifiedProductSpecHighlights } from '@/lib/format-verified-product-spec-highlights';
import { normalizeInferredBrands } from '@/lib/storefront-compare/normalize-inferred-brands';
import { resolveCanonicalBrandKey } from '@/lib/storefront-compare/resolve-canonical-brand-key';
import { toTitleCase } from '@/lib/to-title-case';
import { isAvailableProduct } from './is-available-product';

export interface ClusterFeaturedInventoryProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: number;
  category_slug?: string | null;
  category_slugs?: string[] | null;
  product_key_specs?: Record<string, unknown> | null;
  condition?: string | null;
  stock?: number | null;
  is_parent?: boolean | null;
  parent_product_id?: string | null;
  manage_stock?: boolean | null;
  has_condition_offers?: boolean | null;
}

const GENERIC_CLUSTER_TOKENS = new Set(
  'a an and are at best buy buying by for from galaxy guide how in ipad iphone is it laptop laptops macbook nigeria of on or phone phones pixel playstation price prices redmi review smartphone smartphones specs the to vs with 2024 2025 2026 2027'.split(
    ' '
  )
);

const TIER_MODIFIER_TOKENS = new Set(
  'air fe flip fold lite max mini plus pro slim ultra'.split(' ')
);

const CAPACITY_TOKEN_REGEX = /^\d+(?:gb|tb)$/i;

function isSecondaryModifierToken(token: string): boolean {
  return TIER_MODIFIER_TOKENS.has(token) || CAPACITY_TOKEN_REGEX.test(token);
}

function buildProductHref(
  storeUrl: string,
  product: ClusterFeaturedInventoryProduct
) {
  return product.category_slug
    ? `${storeUrl}/${product.category_slug}/${product.slug}`
    : `${storeUrl}/products/${product.slug}`;
}

function scoreProductModelAffinity(
  product: ClusterFeaturedInventoryProduct,
  articleTitleAndSlug: string,
  excludedBrandTokens: ReadonlySet<string>
): number {
  const articleTokens = articleTitleAndSlug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !excludedBrandTokens.has(token));
  if (articleTokens.length === 0) {
    return 0;
  }
  const articleTokenSet = new Set(articleTokens);
  const articleHasPrimaryModelToken = articleTokens.some(
    (token) => !isSecondaryModifierToken(token)
  );
  const productTokens = new Set(
    `${product.name} ${product.slug}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0 && !excludedBrandTokens.has(token))
  );
  if (productTokens.size === 0) {
    return 0;
  }
  let primaryMatches = 0;
  let tierMatches = 0;
  let capacityMatches = 0;
  for (const token of productTokens) {
    if (articleTokenSet.has(token)) {
      if (TIER_MODIFIER_TOKENS.has(token)) {
        tierMatches += 1;
      } else if (CAPACITY_TOKEN_REGEX.test(token)) {
        capacityMatches += 1;
      } else {
        primaryMatches += 1;
      }
    }
  }
  if (articleHasPrimaryModelToken && primaryMatches === 0) {
    return 0;
  }
  const totalMatches = primaryMatches + tierMatches + capacityMatches;
  return totalMatches > 0
    ? primaryMatches * 2 +
        tierMatches +
        capacityMatches * 0.25 +
        totalMatches / productTokens.size
    : 0;
}

function buildFeaturedProductDescription(
  product: ClusterFeaturedInventoryProduct,
  countryCode?: string | null,
  categorySlug?: string | null
): string {
  const segments: string[] = [product.brand ?? 'Storefront pick'];
  const condition = product.condition?.trim();
  if (condition) segments.push(toTitleCase(condition));
  segments.push(formatCurrencyCompact(product.price, countryCode || 'NG'));

  const highlights = formatVerifiedProductSpecHighlights({
    specs: product.product_key_specs,
    category: product.category_slug ?? categorySlug,
    categorySlugs: product.category_slugs,
    keys: ['ram_gb', 'storage_gb', 'battery_mah'],
    maxHighlights: 2,
  });
  if (highlights.length > 0) segments.push(highlights.join(', '));
  return segments.join(' • ');
}

export function buildClusterFeaturedProducts(
  storeUrl: string,
  categorySlug: string,
  inferredBrands: string[],
  products: ClusterFeaturedInventoryProduct[],
  countryCode?: string | null,
  articleTitleAndSlug = ''
) {
  const inStockProducts = products.filter(isAvailableProduct);
  const normalizedBrands = normalizeInferredBrands(
    categorySlug,
    inferredBrands
  );
  const preferredProducts =
    normalizedBrands.length > 0
      ? inStockProducts.filter((product) =>
          normalizedBrands.includes(
            resolveCanonicalBrandKey(categorySlug, product.brand ?? '')
          )
        )
      : [];
  const selectedPool =
    normalizedBrands.length > 0 ? preferredProducts : inStockProducts;
  const excludedBrandTokens = new Set([
    ...GENERIC_CLUSTER_TOKENS,
    ...normalizedBrands,
    ...inferredBrands.map((brand) => brand.toLowerCase()),
  ]);

  return selectedPool
    .slice()
    .sort((left, right) => {
      const rightAffinity = scoreProductModelAffinity(
        right,
        articleTitleAndSlug,
        excludedBrandTokens
      );
      const leftAffinity = scoreProductModelAffinity(
        left,
        articleTitleAndSlug,
        excludedBrandTokens
      );
      return (
        rightAffinity - leftAffinity ||
        left.price - right.price ||
        left.slug.localeCompare(right.slug)
      );
    })
    .slice(0, 2)
    .map((product) => ({
      href: buildProductHref(storeUrl, product),
      title: product.name,
      description: buildFeaturedProductDescription(
        product,
        countryCode,
        categorySlug
      ),
    }));
}
