import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { createAnonClient } from '@/lib/supabase/anon';
import type {
  FeedOffer,
  FeedProduct,
  FeedVariant,
  ImageManifestMap,
} from './feed-builder';
import { FEED_PRODUCTS_SELECT } from './feed-query';
import { fetchActiveFeedOffers } from './fetch-active-feed-offers';

const FEED_PRODUCTS_PAGE_SIZE = 1000;
const FEED_IMAGE_MANIFEST_PAGE_SIZE = 1000;
// get_feed_product_variants accepts at most 10k product IDs.
const MAX_FEED_PRODUCTS = 10_000;
// Keep PostgREST `in(...)` URL filters under common proxy limits.
const FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE = 250;
export const FEED_PRODUCT_VARIANTS_BATCH_SIZE = 50;
export const FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES = 4;
// Keep variant hydration bounded: the smaller RPC batches reduce DB work per
// call, while limited parallelism prevents cold public feeds from serializing
// up to 200 round trips for max-size merchant catalogs.
export const FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES = 4;

export interface GoogleMerchantFeedData {
  custom_domain: string | null;
  slug: string;
  products: FeedProduct[];
  imageManifest: ImageManifestMap;
}

const GOOGLE_MERCHANT_FEED_DATA_CACHE_VERSION = 'variant-feed-data-v6';

interface RawFeedProductRow extends Omit<FeedProduct, 'categories'> {
  categories?:
    | { name?: string; slug?: string }
    | Array<{ name?: string; slug?: string }>
    | null;
  created_at?: string | null;
  product_categories?: Array<{
    categories?: { name?: string; slug?: string } | null;
  }>;
}

interface FeedProductCursor {
  createdAt: string;
  id: string;
}

type ManifestRow = {
  source_url?: string | null;
  product_id: string;
  variant_id?: string | null;
  verified_url: string | null;
  verified_format: string | null;
  status: string;
  is_primary: boolean;
  position: number;
};

function getFeedProductCursor(
  page: RawFeedProductRow[]
): FeedProductCursor | null {
  for (let index = page.length - 1; index >= 0; index -= 1) {
    const row = page[index];
    if (row?.created_at) {
      return {
        createdAt: row.created_at,
        id: row.id,
      };
    }
  }

  return null;
}

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

function chunkValues<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchActiveFeedProducts(
  supabase: SupabaseClient,
  merchantId: string
): Promise<RawFeedProductRow[]> {
  const products: RawFeedProductRow[] = [];
  let cursor: FeedProductCursor | null = null;
  let readNullCreatedAtRows = false;
  let nullCreatedAtCursorId: string | null = null;

  while (true) {
    let query = supabase
      .from('products')
      .select(FEED_PRODUCTS_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    if (readNullCreatedAtRows) {
      query = query.is('created_at', null);

      if (nullCreatedAtCursorId) {
        query = query.gt('id', nullCreatedAtCursorId);
      }
    } else {
      query = query.not('created_at', 'is', null);
    }

    if (!readNullCreatedAtRows && cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`
      );
    }

    const { data, error } = await (readNullCreatedAtRows
      ? query
          .order('id', { ascending: true })
          .limit(FEED_PRODUCTS_PAGE_SIZE)
          .overrideTypes<RawFeedProductRow[], { merge: false }>()
      : query
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(FEED_PRODUCTS_PAGE_SIZE)
          .overrideTypes<RawFeedProductRow[], { merge: false }>());

    if (error) {
      console.error('DB_PRODUCTS_ERROR:', {
        cursor,
        error,
        merchantId,
        readNullCreatedAtRows,
      });
      throw new Error('Failed to fetch products');
    }

    const page = data || [];
    const remaining = MAX_FEED_PRODUCTS - products.length;
    products.push(...page.slice(0, remaining));

    if (products.length >= MAX_FEED_PRODUCTS) {
      break;
    }

    if (page.length < FEED_PRODUCTS_PAGE_SIZE) {
      if (!readNullCreatedAtRows) {
        readNullCreatedAtRows = true;
        nullCreatedAtCursorId = null;
        continue;
      }
      break;
    }

    if (readNullCreatedAtRows) {
      const lastNullCreatedAtProduct = page.at(-1);
      if (!lastNullCreatedAtProduct?.id) {
        break;
      }

      nullCreatedAtCursorId = lastNullCreatedAtProduct.id;
      continue;
    }

    const nextCursor = getFeedProductCursor(page);
    if (!nextCursor) {
      console.warn('DB_PRODUCTS_CURSOR_WARNING:', { merchantId });
      break;
    }

    cursor = nextCursor;
  }

  return products;
}

interface FeedVariantRow {
  attributes: Record<string, unknown> | null;
  condition?: FeedVariant['condition'];
  id: string;
  price_override?: number | string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
}

function normalizeFeedVariantPrice(
  value: number | string | null | undefined
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

async function fetchFeedVariants(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<FeedVariantRow[]> {
  const variantBatches = chunkValues(
    productIds,
    FEED_PRODUCT_VARIANTS_BATCH_SIZE
  );
  const variantRows: FeedVariantRow[] = [];

  for (
    let batchStart = 0;
    batchStart < variantBatches.length;
    batchStart += FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = variantBatches.slice(
      batchStart,
      batchStart + FEED_PRODUCT_VARIANTS_MAX_CONCURRENT_BATCHES
    );
    const batchResults = await Promise.all(
      batchWindow.map(async (batchProductIds, batchWindowIndex) => {
        const batchIndex = batchStart + batchWindowIndex;
        const { data, error } = await supabase.rpc(
          'get_feed_product_variants',
          {
            p_merchant_id: merchantId,
            p_product_ids: batchProductIds,
          }
        );

        if (error) {
          console.error('DB_VARIANTS_ERROR:', {
            batchIndex,
            batchProductCount: batchProductIds.length,
            error,
            merchantId,
          });
          throw new Error('Failed to fetch product variants');
        }

        return (data || []) as FeedVariantRow[];
      })
    );

    for (const rows of batchResults) {
      if (rows.length > 0) {
        variantRows.push(...rows);
      }
    }
  }

  return variantRows;
}

async function fetchVerifiedImageManifestRows(
  supabase: SupabaseClient,
  merchantId: string,
  productIds: string[]
): Promise<ManifestRow[]> {
  const manifestBatches = chunkValues(
    productIds,
    FEED_IMAGE_MANIFEST_PRODUCT_BATCH_SIZE
  );
  const manifestRows: ManifestRow[] = [];

  for (
    let batchStart = 0;
    batchStart < manifestBatches.length;
    batchStart += FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES
  ) {
    const batchWindow = manifestBatches.slice(
      batchStart,
      batchStart + FEED_IMAGE_MANIFEST_MAX_CONCURRENT_BATCHES
    );
    const batchResults = await Promise.all(
      batchWindow.map(async (batchProductIds, batchWindowIndex) => {
        const batchIndex = batchStart + batchWindowIndex;
        const batchRows: ManifestRow[] = [];
        let offset = 0;

        while (true) {
          const { data, error } = await supabase
            .from('product_feed_images')
            .select(
              'product_id, variant_id, source_url, verified_url, verified_format, status, is_primary, position'
            )
            .eq('merchant_id', merchantId)
            .eq('status', 'verified')
            .in('product_id', batchProductIds)
            .order('product_id', { ascending: true })
            .order('position', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + FEED_IMAGE_MANIFEST_PAGE_SIZE - 1)
            .overrideTypes<ManifestRow[], { merge: false }>();

          if (error) {
            console.error('DB_MANIFEST_ERROR:', {
              batchIndex,
              batchProductCount: batchProductIds.length,
              error,
              merchantId,
              offset,
            });
            throw new Error('Failed to fetch image manifest');
          }

          const page = data || [];
          batchRows.push(...page);

          if (page.length < FEED_IMAGE_MANIFEST_PAGE_SIZE) {
            break;
          }

          offset += FEED_IMAGE_MANIFEST_PAGE_SIZE;
        }

        return batchRows;
      })
    );

    for (const rows of batchResults) {
      if (rows.length > 0) {
        manifestRows.push(...rows);
      }
    }
  }

  return manifestRows;
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

    for (const row of variantRows as FeedVariantRow[]) {
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

  // Fetch condition offers for legacy products that still use them
  const productsWithOffers = feedProducts.filter(
    (p) => p.variant_model !== 'sku_matrix' && p.has_condition_offers
  );

  if (productsWithOffers.length > 0) {
    const offerProductIds = productsWithOffers.map((p) => p.id);
    const offerRows = await fetchActiveFeedOffers(supabase, offerProductIds);

    if (offerRows.length > 0) {
      const offersByProduct = new Map<string, FeedOffer[]>();
      for (const row of offerRows) {
        const pid = row.product_id as string;
        if (!offersByProduct.has(pid)) {
          offersByProduct.set(pid, []);
        }
        offersByProduct.get(pid)?.push({
          images: row.images,
          id: row.id as string,
          condition: row.condition as FeedOffer['condition'],
          price: Number(row.price),
          stock_quantity: row.stock_quantity as number,
        });
      }
      for (const product of feedProducts) {
        product.offers = offersByProduct.get(product.id);
      }
    }
  }

  return {
    custom_domain: primaryDomain?.domain ?? null,
    slug: merchantSlug,
    products: feedProducts,
    imageManifest,
  };
}
