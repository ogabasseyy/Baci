import type { MetadataRoute } from 'next';
import { getCachedCategoryPageData } from '@/lib/cached-data';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import type { RawDbProduct } from '@/lib/raw-db-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildCommercialSupportDiscoveryLinks } from '@/lib/storefront-compare/build-compare-discovery-links';
import { COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT } from '@/lib/storefront-compare/price-band-taxonomy';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import { evaluateStorefrontSlugSafety } from '@/lib/storefront-slug-safety';
import { getGamingGraphicsHubSitemapEntries } from './gaming-graphics-hub-sitemap';
import { getCommercialSupportCategorySitemapEntries } from './get-commercial-support-category-sitemap-entries';
import type { StorefrontSitemapContext } from './sitemap-data';

export const SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS = 45_000;
const SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT =
  COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT;
export const SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY = 4;

function isCategoryWithSlug(category: unknown): category is { slug: string } {
  return (
    typeof category === 'object' &&
    category !== null &&
    'slug' in category &&
    typeof category.slug === 'string'
  );
}

function parseSitemapProductPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

interface SitemapProductRecord {
  id: string;
  name: string;
  slug?: string;
  brand?: string | null;
  price: number | string;
  stock?: number | string | null;
  stock_quantity?: number | string | null;
  manage_stock?: boolean | null;
  has_condition_offers?: boolean;
  categories?: RawDbProduct['categories'];
  product_categories?: RawDbProduct['product_categories'];
  category_slug?: string | null;
  product_key_specs?: unknown;
}

function isSitemapProductRecord(
  product: unknown
): product is SitemapProductRecord {
  if (!product || typeof product !== 'object') {
    return false;
  }
  const candidate = product as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    ((typeof candidate.price === 'number' &&
      Number.isFinite(candidate.price)) ||
      (typeof candidate.price === 'string' &&
        parseSitemapProductPrice(candidate.price) !== null))
  );
}

function getRawProductCategorySlug(
  product: SitemapProductRecord,
  fallbackSlug: string
) {
  const rawDirectCategories: unknown[] = Array.isArray(product.categories)
    ? product.categories
    : product.categories
      ? [product.categories]
      : [];
  const directCategories = rawDirectCategories.filter(isCategoryWithSlug);
  const rawProductCategories: unknown[] =
    product.product_categories?.map((entry) => entry.categories) ?? [];
  const productCategories = rawProductCategories.filter(isCategoryWithSlug);
  const activeCategorySlug = [...directCategories, ...productCategories].find(
    (category) => category.slug === fallbackSlug
  )?.slug;
  const joinedCategorySlug =
    directCategories[0]?.slug || productCategories[0]?.slug;
  const categorySlug =
    activeCategorySlug ||
    joinedCategorySlug ||
    fallbackSlug ||
    product.category_slug;

  return categorySlug;
}

export async function getCommercialSupportSitemapEntries(
  context: StorefrontSitemapContext
): Promise<MetadataRoute.Sitemap> {
  if (!isStorefrontSitemapPublished(context.merchant)) {
    return [];
  }

  const categoryEntries = await getCommercialSupportCategorySitemapEntries({
    merchantId: context.merchant.id,
    storeUrl: context.storeUrl,
    supabase: context.supabase,
  });
  const commercialEntries: MetadataRoute.Sitemap = [];
  const seenCommercialUrls = new Set<string>();
  const graphicsHubEntries = await getGamingGraphicsHubSitemapEntries(context);

  for (const entry of graphicsHubEntries) {
    seenCommercialUrls.add(entry.url);
    commercialEntries.push(entry);
  }

  const merchantCurrency = resolveMerchantCurrencyConfig(context.merchant).code;

  for (
    let index = 0;
    index < categoryEntries.length &&
    commercialEntries.length < SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS;
    index += SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
  ) {
    const categoryBatch = categoryEntries.slice(
      index,
      index + SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY
    );
    const batchEntries = await Promise.all(
      categoryBatch.map(async (entry) => {
        const categorySlug =
          entry.categorySlug ?? entry.url.replace(`${context.storeUrl}/`, '');
        if (!categorySlug || !evaluateStorefrontSlugSafety(categorySlug).safe) {
          return [];
        }
        const categoryData = await getCachedCategoryPageData(
          context.merchant.id,
          categorySlug,
          context.merchant.slug,
          0,
          SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
        );

        if (
          !categoryData ||
          categoryData.isCollection ||
          categoryData.isInactiveCategory ||
          categoryData.categoryQueryFailed ||
          categoryData.productsQueryFailed ||
          categoryData.productIdsQueryFailed
        ) {
          return [];
        }

        const products = (categoryData.products ?? [])
          .filter(isSitemapProductRecord)
          .map((product) => ({
            id: product.id,
            slug: product.slug || product.id,
            name: product.name,
            brand: product.brand ?? null,
            price: parseSitemapProductPrice(product.price) ?? 0,
            stock:
              typeof product.stock === 'number'
                ? product.stock
                : typeof product.stock === 'string'
                  ? Number(product.stock)
                  : null,
            stock_quantity:
              typeof product.stock_quantity === 'number'
                ? product.stock_quantity
                : typeof product.stock_quantity === 'string'
                  ? Number(product.stock_quantity)
                  : null,
            manage_stock: product.manage_stock,
            ...(product.has_condition_offers !== undefined &&
            product.has_condition_offers !== null
              ? { has_condition_offers: Boolean(product.has_condition_offers) }
              : {}),
            category_slug: getRawProductCategorySlug(product, categorySlug),
            product_key_specs: normalizeProductKeySpecs(
              product.product_key_specs
            ),
          }));
        const links = buildCommercialSupportDiscoveryLinks({
          storeUrl: context.storeUrl,
          categorySlug,
          categoryName: categoryData.fallbackName || categorySlug,
          merchantCurrency,
          includeBrandCompareLinks: false,
          products,
        });

        return links.map((link) => ({
          url: link.href,
          lastModified:
            entry.lastModified instanceof Date ? entry.lastModified : undefined,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        }));
      })
    );

    for (const entries of batchEntries) {
      for (const entry of entries) {
        if (commercialEntries.length >= SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS) {
          break;
        }

        if (seenCommercialUrls.has(entry.url)) {
          continue;
        }

        seenCommercialUrls.add(entry.url);
        commercialEntries.push(entry);
      }

      if (commercialEntries.length >= SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS) {
        break;
      }
    }
  }

  return commercialEntries;
}
