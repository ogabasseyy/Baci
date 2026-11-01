import { formatCurrencyCompact } from '@/lib/currency';
import { normalizeInferredBrands } from '@/lib/storefront-compare/normalize-inferred-brands';
import { resolveCanonicalBrandKey } from '@/lib/storefront-compare/resolve-canonical-brand-key';
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
}

const GENERIC_CLUSTER_TOKENS = new Set([
  'galaxy',
  'iphone',
  'macbook',
  'ipad',
  'redmi',
  'phone',
  'phones',
  'smartphone',
  'smartphones',
  'laptop',
  'laptops',
  'nigeria',
  'price',
  'specs',
  'review',
  'guide',
  'best',
]);

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
    .filter((token) => token.length >= 2 && !excludedBrandTokens.has(token));
  if (articleTokens.length === 0) {
    return 0;
  }
  const articleTokenSet = new Set(articleTokens);
  const productTokens = new Set(
    `${product.name} ${product.slug}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2 && !excludedBrandTokens.has(token))
  );
  let matches = 0;
  for (const token of productTokens) {
    if (articleTokenSet.has(token)) {
      matches += 1;
    }
  }
  return matches >= 2 ? matches : 0;
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
      description: `${product.brand ?? 'Storefront pick'} • ${formatCurrencyCompact(product.price, countryCode || 'NG')}`,
    }));
}
