import {
  fetchOfferResolutions,
  type OfferAuthorityRpcCall,
  type ResolvedOfferResolution,
} from '@baci/shared/lib';
import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('FetchStorefrontProductOffers');

export interface StorefrontProductConditionOfferRow {
  compare_at_price?: number | null;
  condition?: string | null;
  condition_notes?: string | null;
  grade?: string | null;
  id: string;
  images?: unknown;
  price?: number | null;
  stock_quantity?: number | null;
}

/**
 * Active condition offers through the single offer-resolution
 * authority (anon-executable, active rows only). Reads through the
 * shared chunking client (200 ids per unscoped call, per the SQL
 * batch cap) instead of one unbounded call — no per-product fan-out
 * and no 201st-id cliff. Prices read the live basis and quantities
 * the allocatable stock (policy-capped, parent-inherited): exactly
 * what checkout enforces. Unbounded rows keep a null quantity
 * (purchasable with no finite count). Same retry and fail-soft shape
 * as the sibling fetches: null on failure so callers skip offer
 * lines instead of corrupting prices.
 */
export async function getStorefrontProductOffersByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductConditionOfferRow[]>;
  }

  // Retry lives inside the adapter so every 200-id chunk of a large
  // set gets its own retries; a chunk failure still fails the whole
  // lookup soft (null), exactly like the old single call.
  const callRpc: OfferAuthorityRpcCall = (args) =>
    withSupabaseRetry(
      async () => {
        const { data, error } = await supabase.rpc(
          'get_storefront_offer_resolution',
          args
        );
        return {
          data,
          error: error ? { message: error.message } : null,
        };
      },
      {
        maxRetries: 3,
        onRetry: (attempt, err) => {
          log.warn(`Product offers rpc retry ${attempt}: ${err.message}`);
        },
      }
    );

  let resolutions: Map<string, ResolvedOfferResolution>;
  try {
    resolutions = await fetchOfferResolutions(callRpc, {
      merchantId: null,
      productIds: uniqueProductIds,
    });
  } catch (error) {
    log.error('Failed to fetch storefront product offers', {
      error,
      productIds: uniqueProductIds,
    });
    return null;
  }

  const offersByProductId: Record<
    string,
    StorefrontProductConditionOfferRow[]
  > = {};
  // Caller-case keys (callers look up by their own id spelling);
  // resolution ids are canonical lowercase, so push through a
  // case-insensitive index instead of direct keying. Every spelling
  // of a duplicate id gets the rows: a lowercase cached row and an
  // uppercase cart row are the same product and must hydrate alike.
  const keysByLowerId = new Map<string, string[]>();
  for (const productId of uniqueProductIds) {
    offersByProductId[productId] = [];
    const bucket = keysByLowerId.get(productId.toLowerCase()) ?? [];
    bucket.push(productId);
    keysByLowerId.set(productId.toLowerCase(), bucket);
  }
  for (const resolution of resolutions.values()) {
    // Discovery-side ad-gate: unshaped parents never hydrate even
    // though checkout would stage their rows (transactions accept
    // all rows; only discovery filters on the flag).
    if (resolution.parentEligible !== true) continue;
    const keys = keysByLowerId.get(resolution.productId);
    if (keys === undefined) continue;
    const offerRow = {
      compare_at_price: resolution.compareAtPrice ?? null,
      condition: resolution.condition,
      condition_notes: resolution.conditionNotes ?? null,
      grade: resolution.grade ?? null,
      id: resolution.offerId,
      images: resolution.images,
      price: resolution.priceBasis,
      stock_quantity: resolution.allocatableStock,
    };
    for (const key of keys) {
      offersByProductId[key]?.push({ ...offerRow });
    }
  }

  return offersByProductId;
}
