import { cacheLife, cacheTag } from 'next/cache';
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

async function readCachedBrandAuthorityInventory(
  merchantId: string,
  categorySlug: string,
  entry: BrandAuthorityEntry
) {
  'use cache';

  try {
    cacheLife('products');
    cacheTag('products', `products-${merchantId}`);
  } catch {
    // Unit tests run without Cache Components enabled.
  }

  const supabase = brandAuthorityPublicData.createClient();
  const inStockProducts: RawDbProduct[] = [];
  let from = 0;

  for (let page = 0; page < BRAND_AUTHORITY_MAX_QUERY_PAGES; page++) {
    const brandQueryValues = brandAuthorityTaxonomy.getBrandQueryValues(entry);
    const baseQuery = supabase
      .from('products')
      .select(BRAND_AUTHORITY_PRODUCTS_SELECT)
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
    const { data, error } = await brandQuery
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + BRAND_AUTHORITY_QUERY_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const rawProducts = (data ?? []) as unknown as RawDbProduct[];

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
  entry: BrandAuthorityEntry
) {
  return readCachedBrandAuthorityInventory(merchantId, categorySlug, entry);
}
