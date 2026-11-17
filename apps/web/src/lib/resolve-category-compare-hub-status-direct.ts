import { z } from 'zod';
import {
  buildCategoryCompareHubLinks,
  buildCategoryCompareHubProductGroups,
  findVisibleCompareHubCategory,
} from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/category-compare-hub-links';
import type { CategoryCompareHubStatus } from '@/app/(storefront)/[slug]/(catalog)/(listing)/[category]/compare/resolve-category-compare-hub-status';
import { getPublicSupabaseClient } from '@/lib/cached-data';
import { buildStoreUrl } from '@/lib/store-url';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { readStorefrontMerchantSnapshot } from '@/lib/storefront-merchant-snapshot';
import { isValidMerchantIdentifier } from '@/lib/validation';

const directMerchantDataSchema = z.object({
  id: z.string(),
  slug: z.string(),
  is_published: z.boolean().nullable().optional(),
  business_name: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
});

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
  signal?: AbortSignal;
}): Promise<CategoryCompareHubStatus> {
  const normalizedIdentifier = input.merchantSlug.trim().toLowerCase();
  if (!isValidMerchantIdentifier(normalizedIdentifier)) {
    return { kind: 'empty' };
  }

  const supabase = getPublicSupabaseClient();
  const snapshot = await readStorefrontMerchantSnapshot(
    supabase,
    normalizedIdentifier
  );
  if (snapshot.status === 'unavailable') {
    throw new Error(`Merchant snapshot unavailable: ${snapshot.error.kind}`);
  }
  if (snapshot.status === 'not_found') {
    return { kind: 'empty' };
  }

  const parsedMerchant = directMerchantDataSchema.safeParse(
    snapshot.value.merchant_data
  );
  if (!parsedMerchant.success) {
    return { kind: 'unknown' };
  }
  const merchant = parsedMerchant.data;

  if (!merchant.is_published && process.env.NODE_ENV !== 'development') {
    return { kind: 'unknown' };
  }

  const requestedCategorySlug = canonicalizeCategorySlug(input.categorySlug);
  if (!requestedCategorySlug) {
    return { kind: 'empty' };
  }

  const categoriesQuery = supabase
    .from('categories')
    .select('id, name, slug, is_active, parent_id')
    .eq('merchant_id', merchant.id)
    .order('name', { ascending: true });
  const { data: categories, error: categoriesError } = await (input.signal &&
  'abortSignal' in categoriesQuery &&
  typeof categoriesQuery.abortSignal === 'function'
    ? categoriesQuery.abortSignal(input.signal)
    : categoriesQuery
  ).returns<DirectCategoryRow[]>();

  if (categoriesError) {
    throw categoriesError;
  }
  if (!categories || categories.length === 0) {
    return { kind: 'unknown' };
  }

  const category = findVisibleCompareHubCategory(
    categories,
    requestedCategorySlug
  );
  if (!category?.name) {
    return { kind: 'empty' };
  }

  const productGroups = await buildCategoryCompareHubProductGroups({
    categories,
    category,
    merchantId: merchant.id,
  });

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
      custom_domain: snapshot.value.custom_domain ?? undefined,
    }),
  });

  return compareLinks.length === 0
    ? { kind: 'empty' }
    : { kind: 'renderable', merchantId: merchant.id };
}
