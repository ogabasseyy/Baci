import { buildCategoryCompareHubLinks } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/category-compare-hub-links';
import type { CategoryCompareHubStatus } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/resolve-category-compare-hub-status';
import { getPublicSupabaseClient } from '@/lib/cached-data';
import { getSlugForCustomDomain } from '@/lib/domain-cache-simple';
import { buildStoreUrl } from '@/lib/store-url';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { getCachedProductSemanticInventory } from '@/lib/storefront-product/get-cached-product-semantic-inventory';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';

interface DirectMerchantRow {
  id: string;
  slug: string;
  is_published: boolean | null;
  business_name: string | null;
  country: string | null;
}

interface DirectCategoryRow {
  id: string;
  name: string | null;
  slug: string | null;
  is_active: boolean | null;
  parent_id: string | null;
}

/**
 * Proxy-safe direct lookup for category compare-hub status (no `'use cache'`
 * directives, which Next.js `proxy.ts` does not support).
 */
export async function resolveCategoryCompareHubStatusDirect(input: {
  merchantSlug: string;
  categorySlug: string;
}): Promise<CategoryCompareHubStatus> {
  const normalizedIdentifier = input.merchantSlug.trim().toLowerCase();
  if (!isValidMerchantIdentifier(normalizedIdentifier)) {
    return { kind: 'empty' };
  }

  const isDomain = isDomainIdentifier(normalizedIdentifier);
  const resolvedSlug = isDomain
    ? await getSlugForCustomDomain(normalizedIdentifier)
    : normalizedIdentifier;
  if (!resolvedSlug) {
    return { kind: 'empty' };
  }

  const supabase = getPublicSupabaseClient();
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('id, slug, is_published, business_name, country')
    .eq('slug', resolvedSlug.toLowerCase())
    .maybeSingle<DirectMerchantRow>();

  if (merchantError) {
    throw merchantError;
  }
  if (!merchant) {
    return { kind: 'empty' };
  }

  if (!merchant.is_published && process.env.NODE_ENV !== 'development') {
    return { kind: 'unknown' };
  }

  const requestedCategorySlug = canonicalizeCategorySlug(input.categorySlug);
  if (!requestedCategorySlug) {
    return { kind: 'empty' };
  }

  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('id, name, slug, is_active, parent_id')
    .eq('merchant_id', merchant.id)
    .order('name', { ascending: true })
    .returns<DirectCategoryRow[]>();

  if (categoriesError) {
    throw categoriesError;
  }
  if (!categories || categories.length === 0) {
    return { kind: 'unknown' };
  }

  const category = categories.find(
    (entry) =>
      entry.is_active !== false &&
      canonicalizeCategorySlug(entry.slug) === requestedCategorySlug
  );
  if (!category?.name) {
    return { kind: 'empty' };
  }

  const scopedCategories = [
    category,
    ...categories.filter(
      (entry) => entry.parent_id === category.id && entry.is_active === true
    ),
  ];
  const seenSlugs = new Set<string>();
  const productGroups = await Promise.all(
    scopedCategories.flatMap((entry) => {
      const categorySlug = canonicalizeCategorySlug(entry.slug);
      const categoryName = entry.name?.trim();
      if (!categorySlug || !categoryName || seenSlugs.has(categorySlug)) {
        return [];
      }
      seenSlugs.add(categorySlug);

      return [
        getCachedProductSemanticInventory(merchant.id, categorySlug).then(
          (products) => ({
            categoryName,
            categorySlug,
            products,
            inventoryLoadFailed: false,
          }),
          () => ({
            categoryName,
            categorySlug,
            products: [],
            inventoryLoadFailed: true,
          })
        ),
      ];
    })
  );

  if (productGroups.some((group) => group.inventoryLoadFailed)) {
    return { kind: 'unknown' };
  }

  const compareLinks = buildCategoryCompareHubLinks({
    categoryName: category.name,
    categorySlug: requestedCategorySlug,
    merchant: {
      id: merchant.id,
      slug: merchant.slug,
      business_name: merchant.business_name ?? merchant.slug,
      country: merchant.country ?? undefined,
    } as Parameters<typeof buildCategoryCompareHubLinks>[0]['merchant'],
    productGroups: productGroups.map(
      ({ categoryName, categorySlug, products }) => ({
        categoryName,
        categorySlug,
        products,
      })
    ),
    products: productGroups.flatMap((group) => group.products),
    inventoryDegraded: false,
    storeUrl: buildStoreUrl({
      slug: merchant.slug,
      custom_domain: isDomain ? normalizedIdentifier : undefined,
    }),
  });

  return compareLinks.length === 0
    ? { kind: 'empty' }
    : { kind: 'renderable', merchantId: merchant.id };
}
