import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleOrderProductBlogPurge } from '@/lib/schedule-order-product-blog-purge';
import type { Database } from '@/types/supabase';

const QUIZ_CACHE_TARGET_BATCH_LIMIT = 1000;
const QUIZ_EVENT_ID_CHUNK_SIZE = 100;

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

interface QuizCacheTargetPage<T> {
  data: T[] | null;
  error: unknown;
}

/**
 * Drain a bounded target sweep across pages. The next worker iteration uses
 * a new `changedAfter` timestamp, so rows truncated by a single limited
 * query would never be revisited; pagination keeps every changed row
 * covered. A mid-sweep failure keeps the pages already collected but flags
 * the sweep incomplete — the run must conservatively invalidate instead of
 * treating the partial set as complete.
 */
async function collectQuizCacheTargetRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<QuizCacheTargetPage<T>>
): Promise<{ incomplete: boolean; rows: T[] }> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    let result: QuizCacheTargetPage<T>;
    try {
      result = await fetchPage(
        page * QUIZ_CACHE_TARGET_BATCH_LIMIT,
        (page + 1) * QUIZ_CACHE_TARGET_BATCH_LIMIT - 1
      );
    } catch {
      return { incomplete: true, rows };
    }
    if (result.error) {
      return { incomplete: true, rows };
    }
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < QUIZ_CACHE_TARGET_BATCH_LIMIT) {
      return { incomplete: false, rows };
    }
  }
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
  let sweepIncomplete = false;

  try {
    const eventPage = await collectQuizCacheTargetRows<QuizEventCacheRow>(
      (from, to) =>
        client
          .from('quiz_events')
          .select('id, merchant_id, settings')
          .gte('updated_at', changedAfter)
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
    );
    sweepIncomplete = sweepIncomplete || eventPage.incomplete;
    for (const row of eventPage.rows) {
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
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
    sweepIncomplete = true;
  }

  try {
    const reservationPage =
      await collectQuizCacheTargetRows<QuizReservationCacheRow>((from, to) =>
        client
          .from('quiz_prize_reservations')
          .select('merchant_id, product_id')
          .gte('updated_at', changedAfter)
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
      );
    sweepIncomplete = sweepIncomplete || reservationPage.incomplete;
    for (const row of reservationPage.rows) {
      addProductId(productIdsByMerchant, row.merchant_id, row.product_id);
    }
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
    sweepIncomplete = true;
  }

  let awardRows: QuizAwardCacheRow[] = [];
  try {
    const awardPage = await collectQuizCacheTargetRows<QuizAwardCacheRow>(
      (from, to) =>
        client
          .from('quiz_awards')
          .select('event_id, product_id')
          .not('expired_at', 'is', null)
          .gte('expired_at', changedAfter)
          .order('expired_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to)
    );
    sweepIncomplete = sweepIncomplete || awardPage.incomplete;
    awardRows = awardPage.rows;
  } catch {
    // The quiz RPC already completed; cache expiry remains best effort.
    sweepIncomplete = true;
  }
  const expiredEventIds = Array.from(
    new Set(
      awardRows
        .map((row) => row.event_id)
        .filter((eventId): eventId is string => typeof eventId === 'string')
    )
  );
  if (expiredEventIds.length > 0) {
    // The paginated award sweep can now exceed one batch; keep the
    // PostgREST `.in(...)` URL bounded with id chunks.
    for (
      let start = 0;
      start < expiredEventIds.length;
      start += QUIZ_EVENT_ID_CHUNK_SIZE
    ) {
      try {
        const expiredEventResult = await client
          .from('quiz_events')
          .select('id, merchant_id')
          .in(
            'id',
            expiredEventIds.slice(start, start + QUIZ_EVENT_ID_CHUNK_SIZE)
          );
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

  if (sweepIncomplete) {
    // A mid-sweep page failure leaves rows past the failure unknown, and
    // the next worker iteration uses a new `changedAfter` that will never
    // revisit them. Escalate the collected merchants to the conservative
    // hostname fallback instead of purging a partial product set.
    console.warn(
      'Quiz product cache sweep incomplete; escalating collected merchants to hostname purge',
      { changedAfter }
    );
  }
  for (const [merchantId, productIds] of productIdsByMerchant) {
    try {
      await scheduleOrderProductBlogPurge({
        merchantId,
        productIds: Array.from(productIds),
        supabase: client,
        ...(sweepIncomplete ? { targetSweepIncomplete: true } : {}),
      });
    } catch {
      // The quiz RPC already completed; edge eviction remains best effort.
    }
  }
}
