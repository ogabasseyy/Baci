import { cacheLife, cacheTag } from 'next/cache';
import { createAnonClient } from '@/lib/supabase/anon';
import type {
  FeedProduct,
  FeedVariant,
  ImageManifestMap,
} from './feed-builder';
import { FEED_FETCH_CONSTANTS } from './feed-fetch-constants';
import {
  fetchActiveFeedProducts,
  type RawFeedProductRow,
} from './fetch-active-feed-products';
import { fetchFeedVariants } from './fetch-feed-variants';
import { fetchVerifiedImageManifestRows } from './fetch-verified-image-manifest';
import { attachConditionOffers } from './hydrate-feed-condition-offers';
import { normalizeFeedVariantPrice } from './normalize-feed-variant-price';

export const FEED_PRODUCT_VARIANTS_BATCH_SIZE =
  FEED_FETCH_CONSTANTS.VARIANTS_BATCH_SIZE;
export const FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES =
  FEED_FETCH_CONSTANTS.VARIANTS_MAX_CONCURRENT_BATCHES;
export const FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES =
  FEED_FETCH_CONSTANTS.MANIFEST_MAX_CONCURRENT_BATCHES;

export interface GoogleMerchantFeedData {
  custom_domain: string | null;
  slug: string;
  products: FeedProduct[];
  imageManifest: ImageManifestMap;
}

const GOOGLE_MERCHANT_FEED_DATA_CACHE_VERSION = 'variant-feed-data-v6';

function getJoinedCategory(
  product: RawFeedProductRow
): { name?: string; slug?: string } | null {
  if (Array.isArray(product.categories)) {
    return product.categories[0] ?? null;
  }

  if (product.categories) {
    return product.categories;
  }

  return product.product_categories?.[0]?.categories ?? null;
}

function normalizeFeedProducts(products: RawFeedProductRow[]): FeedProduct[] {
  return products.map((product) => {
    const { product_categories: _productCategories, ...rest } = product;
    const joinedCategory = getJoinedCategory(product);

    return {
      ...rest,
      categories: joinedCategory ?? null,
      // The legacy products.category_slug column is absent in production.
      category_slug: joinedCategory?.slug ?? null,
      category: rest.category ?? joinedCategory?.name ?? null,
    };
  });
}

/**
 * Cached data fetcher for Google Merchant feed.
 * Uses `'use cache'` with the `products` cache profile.
 *
 * Must use `createAnonClient()` (stateless, no request-scoped state)
 * because `'use cache'` functions must not capture request context.
 */
export async function getCachedGoogleMerchantFeedData(
  merchantId: string,
  merchantSlug: string
): Promise<GoogleMerchantFeedData> {
  return await getCachedGoogleMerchantFeedDataForVersion(
    merchantId,
    merchantSlug,
    GOOGLE_MERCHANT_FEED_DATA_CACHE_VERSION
  );
}

async function getCachedGoogleMerchantFeedDataForVersion(
  merchantId: string,
  merchantSlug: string,
  cacheVersion: string
): Promise<GoogleMerchantFeedData> {
  'use cache';
  void cacheVersion;
  cacheLife('products');
  cacheTag('google-merchant-feed', 'products', `merchant-feed-${merchantId}`);

  return await getGoogleMerchantFeedData(merchantId, merchantSlug);
}

export async function getGoogleMerchantFeedData(
  merchantId: string,
  merchantSlug: string
): Promise<GoogleMerchantFeedData> {
  const supabase = createAnonClient();

  const { data: primaryDomain, error: domainError } = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', merchantId)
    .eq('status', 'active')
    .eq('is_primary', true)
    .maybeSingle();

  if (domainError) {
    console.error('DB_DOMAIN_ERROR:', domainError);
    throw new Error('Failed to fetch merchant domain');
  }

  const products = await fetchActiveFeedProducts(supabase, merchantId);

  // Fetch prevalidated image manifest only for active products in bounded
  // chunks, keeping PostgREST `in(...)` filters under common proxy limits.
  const feedProducts: FeedProduct[] = normalizeFeedProducts(products).map(
    (product) => ({
      ...product,
      variants: [] as FeedVariant[],
    })
  );
  const productIds = feedProducts.map((p) => p.id);

  if (productIds.length === 0) {
    return {
      custom_domain: primaryDomain?.domain ?? null,
      slug: merchantSlug,
      products: [],
      imageManifest: {} as ImageManifestMap,
    };
  }

  const manifestRows = await fetchVerifiedImageManifestRows(
    supabase,
    merchantId,
    productIds
  );

  // Group manifest rows by product_id
  const imageManifest: ImageManifestMap = {};
  for (const row of manifestRows) {
    if (!imageManifest[row.product_id]) {
      imageManifest[row.product_id] = [];
    }
    imageManifest[row.product_id].push({
      source_url: row.source_url,
      variant_id: row.variant_id ?? null,
      verified_url: row.verified_url,
      verified_format: row.verified_format,
      status: 'verified' as const,
      is_primary: row.is_primary,
      position: row.position,
    });
  }

  const variantRows = await fetchFeedVariants(supabase, merchantId, productIds);

  if (variantRows && variantRows.length > 0) {
    const variantsByProduct = new Map<string, FeedVariant[]>();

    for (const row of variantRows) {
      const productVariants = variantsByProduct.get(row.product_id) ?? [];
      productVariants.push({
        id: row.id,
        attributes: row.attributes,
        condition: row.condition,
        price_override: normalizeFeedVariantPrice(row.price_override),
        sku: row.sku ?? null,
        stock_quantity: row.stock_quantity ?? null,
      });
      variantsByProduct.set(row.product_id, productVariants);
    }

    for (const product of feedProducts) {
      product.variants = variantsByProduct.get(product.id) ?? [];
    }
  }

  await attachConditionOffers(supabase, feedProducts);

  return {
    custom_domain: primaryDomain?.domain ?? null,
    slug: merchantSlug,
    products: feedProducts,
    imageManifest,
  };
}
