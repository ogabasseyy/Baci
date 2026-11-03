import type { MetadataRoute } from 'next';
import { getCachedCategoryPageData } from '@/lib/cached-data';
import { normalizeProductKeySpecs } from '@/lib/product-key-specs-normalize';
import { isRawDbProductRecord, type RawDbProduct } from '@/lib/raw-db-product';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { buildCommercialSupportDiscoveryLinks } from '@/lib/storefront-compare/build-compare-discovery-links';
import { isStorefrontSitemapPublished } from '@/lib/storefront-seo/is-storefront-sitemap-published';
import { getGamingGraphicsHubSitemapEntries } from './gaming-graphics-hub-sitemap';
import { getCommercialSupportCategorySitemapEntries } from './get-commercial-support-category-sitemap-entries';
import type { StorefrontSitemapContext } from './sitemap-data';

export const SITEMAP_MAX_COMMERCIAL_SUPPORT_URLS = 45_000;
const SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT = 150;
export const SITEMAP_COMMERCIAL_SUPPORT_CATEGORY_CONCURRENCY = 4;

function isCategoryWithSlug(category: unknown): category is { slug: string } {
  return (
    typeof category === 'object' &&
    category !== null &&
    'slug' in category &&
    typeof category.slug === 'string'
  );
}

function getRawProductCategorySlug(
  product: RawDbProduct,
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
        const categorySlug = entry.url.replace(`${context.storeUrl}/`, '');
        const categoryData = await getCachedCategoryPageData(
          context.merchant.id,
          categorySlug,
          context.merchant.slug,
          0,
          SITEMAP_COMMERCIAL_SUPPORT_PRODUCTS_PER_CATEGORY_LIMIT
        );

        if (!categoryData || categoryData.isCollection) {
          return [];
        }

        const products = (categoryData.products ?? [])
          .filter(isRawDbProductRecord)
          .map((product) => ({
            slug: product.slug || product.id,
            name: product.name,
            brand: product.brand,
            price: product.price,
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
