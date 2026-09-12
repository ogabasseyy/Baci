import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleOrderProductBlogPurge } from '@/lib/schedule-order-product-blog-purge';
import type { Database } from '@/types/supabase';

const QUIZ_CACHE_TARGET_BATCH_LIMIT = 1000;

type QuizClient = SupabaseClient<Database>;

interface QuizEventCacheRow {
  id?: unknown;
  merchant_id?: unknown;
  settings?: unknown;
}

interface QuizAwardCacheRow {
  event_id?: unknown;
  product_id?: unknown;
}

interface QuizReservationCacheRow {
  merchant_id?: unknown;
  product_id?: unknown;
}

function getProductPrizeId(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  const productId = (settings as Record<string, unknown>).prize_product_id;
  if (typeof productId !== 'string' || productId.trim().length === 0) {
    return null;
  }
  return productId.trim();
}

function addProductId(
  targets: Map<string, Set<string>>,
  merchantIdValue: unknown,
  productIdValue: unknown
) {
  if (
    typeof merchantIdValue !== 'string' ||
    merchantIdValue.trim().length === 0 ||
    typeof productIdValue !== 'string' ||
    productIdValue.trim().length === 0
  ) {
    return;
  }

  const merchantId = merchantIdValue.trim();
  const productId = productIdValue.trim();
  const productIds = targets.get(merchantId) ?? new Set<string>();
  productIds.add(productId);
  targets.set(merchantId, productIds);
}

/**
 * Expire product/blog cache tags for quiz prize mutations observed by the
 * worker. Quiz RPCs mutate reservation rows inside the database, so this
 * small post-RPC sweep keeps the cached enrichment from serving the previous
 * availability snapshot while the durable outbox catches up.
 */
export async function invalidateQuizProductCaches(
  client: QuizClient,
  changedAfter: string
): Promise<void> {
  if (typeof (client as { from?: unknown }).from !== 'function') return;

  const productIdsByMerchant = new Map<string, Set<string>>();
  const eventMerchantIds = new Map<string, string>();

  try {
    const eventResult = await client
      .from('quiz_events')
      .select('id, merchant_id, settings')
      .gte('updated_at', changedAfter)
      .limit(QUIZ_CACHE_TARGET_BATCH_LIMIT);
    if (!eventResult.error) {
      for (const row of (eventResult.data ?? []) as QuizEventCacheRow[]) {
        if (
          typeof row.id === 'string' &&
          row.id.trim().length > 0 &&
          typeof row.merchant_id === 'string' &&
          row.merchant_id.trim().length > 0
        ) {
          eventMerchantIds.set(row.id.trim(), row.merchant_id.trim());
        }
        addProductId(
          productIdsByMerchant,
          row.merchant_id,
          getProductPrizeId(row.settings)
        );
      }
    }
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
  }

  try {
    const reservationResult = await client
      .from('quiz_prize_reservations')
      .select('merchant_id, product_id')
      .gte('updated_at', changedAfter)
      .limit(QUIZ_CACHE_TARGET_BATCH_LIMIT);
    if (!reservationResult.error) {
      for (const row of (reservationResult.data ??
        []) as QuizReservationCacheRow[]) {
        addProductId(productIdsByMerchant, row.merchant_id, row.product_id);
      }
    }
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
  }

  let awardRows: QuizAwardCacheRow[] = [];
  try {
    const awardResult = await client
      .from('quiz_awards')
      .select('event_id, product_id')
      .not('expired_at', 'is', null)
      .gte('expired_at', changedAfter)
      .limit(QUIZ_CACHE_TARGET_BATCH_LIMIT);
    if (!awardResult.error) {
      awardRows = (awardResult.data ?? []) as QuizAwardCacheRow[];
    }
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
  }
  const expiredEventIds = Array.from(
    new Set(
      awardRows
        .map((row) => row.event_id)
        .filter((eventId): eventId is string => typeof eventId === 'string')
    )
  );
  if (expiredEventIds.length > 0) {
    try {
      const expiredEventResult = await client
        .from('quiz_events')
        .select('id, merchant_id')
        .in('id', expiredEventIds);
      if (!expiredEventResult.error) {
        for (const row of (expiredEventResult.data ??
          []) as QuizEventCacheRow[]) {
          if (
            typeof row.id === 'string' &&
            row.id.trim().length > 0 &&
            typeof row.merchant_id === 'string' &&
            row.merchant_id.trim().length > 0
          ) {
            eventMerchantIds.set(row.id.trim(), row.merchant_id.trim());
          }
        }
      }
    } catch {
      // The quiz RPC already completed; cache expiry remains best effort.
    }
  }

  for (const award of awardRows) {
    addProductId(
      productIdsByMerchant,
      typeof award.event_id === 'string'
        ? eventMerchantIds.get(award.event_id.trim())
        : null,
      award.product_id
    );
  }

  for (const [merchantId, productIds] of productIdsByMerchant) {
    try {
      await scheduleOrderProductBlogPurge({
        merchantId,
        productIds: Array.from(productIds),
        supabase: client,
      });
    } catch {
      // The quiz RPC already completed; edge eviction remains best effort.
    }
  }
}
