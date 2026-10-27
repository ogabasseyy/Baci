import { cacheLife, cacheTag } from 'next/cache';
import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import { hydrateAndSanitizePublicProducts } from '@/lib/hydrate-public-products';
import type { RawDbProduct } from '@/lib/normalize-product';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from '@/lib/product-key-specs-select';
import { generateSlug } from '@/lib/seo-utils';
import { brandAuthorityPublicData } from '@/lib/storefront-category/brand-authority-public-data';
import { isBrandAuthorityProductInStock } from '@/lib/storefront-category/brand-authority-stock-filter';
import { brandAuthorityTaxonomy } from '@/lib/storefront-category/brand-authority-taxonomy';
import type { BrandAuthorityEntry } from '@/lib/storefront-category/category-hub-types';

export { BRAND_AUTHORITY_PRODUCT_LIMIT } from '@/lib/storefront-category/brand-authority-product-limit';
export const BRAND_AUTHORITY_MAX_QUERY_PAGES = 20;
/** Complete-pool ceiling shared by optional PDP and article enrichment. */
export const OPTIONAL_AUTHORITY_INVENTORY_MAX_PRODUCTS = 100;
export const BRAND_AUTHORITY_QUERY_PAGE_SIZE = 100;
export const BRAND_AUTHORITY_PRODUCTS_SELECT = `
  id,
  name,
  slug,
  description,
  images,
  category,
  brand,
  price,
  compare_at_price,
  condition,
  stock,
  stock_quantity,
  manage_stock,
  is_parent,
  parent_product_id,
  ${PRODUCT_KEY_SPECS_RELATION_SELECT},
  has_condition_offers,
  updated_at,
  categories:category_id(id, name, slug),
  product_categories(
    categories(
      id,
      name,
      slug
    )
  )
`;

// Same scope and hydration as destination cards, without display-only payloads.
const BRAND_AUTHORITY_ELIGIBILITY_SELECT = `
  id, name, slug, brand, price, stock, stock_quantity, manage_stock,
  is_parent, parent_product_id, category,
  categories:category_id(id, slug),
  product_categories(categories(id, slug))
`;

export function matchesBrandAuthorityCategory(
  product: RawDbProduct,
  categorySlug: string
): boolean {
  const targetSlug = generateSlug(categorySlug);

  if (
    Array.isArray(product.product_categories) &&
    product.product_categories.some((entry) => {
      const slug = entry?.categories?.slug;
      return (
        slug === categorySlug ||
        (slug ? generateSlug(slug) === targetSlug : false)
      );
    })
  ) {
    return true;
  }

  const directCategories = Array.isArray(product.categories)
    ? product.categories
    : product.categories
      ? [product.categories]
      : [];
  if (
    directCategories.some((cat) => {
      const slug = cat?.slug;
      return (
        slug === categorySlug ||
        (slug ? generateSlug(slug) === targetSlug : false)
      );
    })
  ) {
    return true;
  }

  if (
    typeof product.category === 'string' &&
    product.category.trim().length > 0 &&
    generateSlug(product.category) === targetSlug
  ) {
    return true;
  }

  return false;
}

/** Optional enrichment must prove a complete pool within a fixed work budget. */
export interface BrandAuthorityInventoryBudget {
  maxProducts: number;
  timeoutMs: number;
}

async function readCachedBrandAuthorityInventory(
  merchantId: string,
  categorySlug: string,
  entry: BrandAuthorityEntry,
  budget?: BrandAuthorityInventoryBudget
) {
  'use cache';

  try {
    cacheLife('products');
    cacheTag(
      'products',
      `products-${merchantId}`,
      'categories',
      `categories-${merchantId}`
    );
  } catch {
    // Unit tests run without Cache Components enabled.
  }

  const deadline = budget
    ? createStorefrontReadDeadline(budget.timeoutMs)
    : null;
  try {
    return await (deadline
      ? Promise.race([
          readInventory(
            merchantId,
            categorySlug,
            entry,
            budget,
            deadline.signal
          ),
          deadline.promise,
        ])
      : readInventory(merchantId, categorySlug, entry));
  } finally {
    deadline?.cleanup();
  }
}

async function readInventory(
  merchantId: string,
  categorySlug: string,
  entry: BrandAuthorityEntry,
  budget?: BrandAuthorityInventoryBudget,
  signal?: AbortSignal
) {
  if (
    budget &&
    (!Number.isInteger(budget.maxProducts) ||
      budget.maxProducts < 1 ||
      budget.maxProducts > 200 ||
      !Number.isFinite(budget.timeoutMs) ||
      budget.timeoutMs <= 0)
  ) {
    throw new Error('Invalid brand authority inventory budget');
  }
  if (budget) {
    const category = await brandAuthorityPublicData.readCategory(
      merchantId,
      categorySlug,
      signal
    );
    signal?.throwIfAborted();
    if (!category) throw new Error('Brand authority category unavailable');
  }
  const supabase = brandAuthorityPublicData.createClient(signal);
  // Keep PostgREST's type parser from expanding both long select literals.
  const productSelect: string = budget
    ? BRAND_AUTHORITY_ELIGIBILITY_SELECT
    : BRAND_AUTHORITY_PRODUCTS_SELECT;
  const inStockProducts: RawDbProduct[] = [];
  let from = 0;

  for (
    let page = 0;
    page < (budget ? 1 : BRAND_AUTHORITY_MAX_QUERY_PAGES);
    page++
  ) {
    signal?.throwIfAborted();
    const brandQueryValues = brandAuthorityTaxonomy.getBrandQueryValues(entry);
    const baseQuery = supabase
      .from('products')
      .select(productSelect, budget ? { count: 'exact' } : undefined)
      .eq('merchant_id', merchantId)
      .eq('status', 'active');
    const brandQuery =
      brandQueryValues.length === 1
        ? baseQuery
            .or('is_parent.eq.true,parent_product_id.is.null')
            .ilike('brand', brandQueryValues[0])
        : baseQuery.or(
            brandQueryValues
              .flatMap((value) => [
                `and(is_parent.eq.true,brand.ilike.${value})`,
                `and(parent_product_id.is.null,brand.ilike.${value})`,
              ])
              .join(',')
          );
    const { data, error, count } = await brandQuery
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(
        from,
        budget ? budget.maxProducts : from + BRAND_AUTHORITY_QUERY_PAGE_SIZE - 1
      );

    signal?.throwIfAborted();

    if (error) {
      throw error;
    }

    const rawProducts = (data ?? []) as unknown as RawDbProduct[];
    // Reject oversized or server-truncated pools before hydration fanout.
    if (
      budget &&
      (count == null ||
        count !== rawProducts.length ||
        count > budget.maxProducts)
    ) {
      throw new Error('Brand authority inventory exceeds complete-pool budget');
    }

    if (
      page + 1 >= BRAND_AUTHORITY_MAX_QUERY_PAGES &&
      rawProducts.length === BRAND_AUTHORITY_QUERY_PAGE_SIZE
    ) {
      throw new Error(
        'Brand authority inventory scan exceeded maximum page ceiling'
      );
    }

    const matchingProducts = rawProducts.filter((product) =>
      matchesBrandAuthorityCategory(product, categorySlug)
    );

    if (matchingProducts.length > 0) {
      const hydratedProducts = await hydrateAndSanitizePublicProducts(
        supabase,
        merchantId,
        matchingProducts
      );
      signal?.throwIfAborted();
      inStockProducts.push(
        ...hydratedProducts.filter(isBrandAuthorityProductInStock)
      );
    }

    if (rawProducts.length < BRAND_AUTHORITY_QUERY_PAGE_SIZE) {
      break;
    }
    from += BRAND_AUTHORITY_QUERY_PAGE_SIZE;
  }

  const latestUpdatedAt = inStockProducts[0]?.updated_at;
  return {
    latestUpdatedAt:
      typeof latestUpdatedAt === 'string' ? latestUpdatedAt : null,
    productCount: inStockProducts.length,
    productCountIsLowerBound: false,
    products: inStockProducts,
  };
}

export function getCachedBrandAuthorityInventory(
  merchantId: string,
  categorySlug: string,
  entry: BrandAuthorityEntry,
  budget?: BrandAuthorityInventoryBudget
) {
  return readCachedBrandAuthorityInventory(
    merchantId,
    categorySlug,
    entry,
    budget
  );
}
