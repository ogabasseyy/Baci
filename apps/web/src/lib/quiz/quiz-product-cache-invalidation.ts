import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleOrderProductBlogPurge } from '@/lib/schedule-order-product-blog-purge';
import type { Database } from '@/types/supabase';

const QUIZ_CACHE_TARGET_BATCH_LIMIT = 1000;
const QUIZ_EVENT_ID_CHUNK_SIZE = 100;
/**
 * Merchants purged concurrently per delivery chunk. Each purge can spend up
 * to ~5s in the standalone-worker HTTP fallback, and the deployed worker is
 * SIGTERMed after 50s with no delivery cursor — serial delivery would let
 * ten slow merchants kill the run before later merchants are visited, and
 * the next run's fresh watermarks would never revisit them. Five-way chunks
 * bound ten slow merchants to ~10s while keeping DB/HTTP fan-out modest.
 */
const QUIZ_PURGE_MERCHANT_CONCURRENCY = 5;
/**
 * Overlap applied when a watermark probe fails: the worker and database
 * clocks can disagree, so a worker-derived fallback floor looks this far
 * back to avoid skipping rows the failed probe would have covered.
 */
const QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS = 2 * 60 * 1000;

type QuizClient = SupabaseClient<Database>;

/** Per-table sweep floors, all in the database clock domain when probed. */
export interface QuizSweepWatermarks {
  /** `quiz_events.updated_at` sweep floor. */
  events: string;
  /** `quiz_prize_reservations.updated_at` sweep floor. */
  reservations: string;
  /** `quiz_awards.expired_at` sweep floor. */
  awards: string;
}

async function probeTableMaxTimestamp(
  client: QuizClient,
  table: 'quiz_awards' | 'quiz_events' | 'quiz_prize_reservations',
  column: 'expired_at' | 'updated_at'
): Promise<string | null> {
  try {
    // Dynamic table/column union the generated types cannot express; the
    // result is validated below and any miss falls back to the overlapped
    // worker floor.
    const loose = client as unknown as SupabaseClient;
    let query = loose.from(table).select(column);
    if (column === 'expired_at') {
      query = query.not(column, 'is', null);
    }
    const { data, error } = await query
      .order(column, { ascending: false })
      .limit(1);
    if (error) return null;
    const rows = (data ?? []) as Record<string, unknown>[];
    const value = rows[0]?.[column];
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/**
 * Resolve per-table sweep watermarks from the database clock. The worker
 * clock can run ahead of the database clock, in which case a worker-derived
 * watermark is newer than the `clock_timestamp()` values the finalization
 * RPCs just wrote — the `.gte()` sweeps would omit this run's rows, and the
 * next run's even newer watermark would never revisit them. Probing each
 * table's current maximum keeps every watermark in the same clock domain as
 * the column it filters (a separate floor per table also avoids one quiet
 * table dragging the shared floor into a full re-sweep). A failed or empty
 * probe falls back to the worker start minus an overlap margin: bounded
 * over-invalidation instead of a silent skip.
 */
export async function resolveQuizSweepWatermarks(
  client: QuizClient,
  fallbackBaseIso: string
): Promise<QuizSweepWatermarks> {
  const fallbackBase = Date.parse(fallbackBaseIso);
  const fallback = new Date(
    (Number.isNaN(fallbackBase) ? Date.now() : fallbackBase) -
      QUIZ_SWEEP_CLOCK_SKEW_MARGIN_MS
  ).toISOString();
  const [events, reservations, awards] = await Promise.all([
    probeTableMaxTimestamp(client, 'quiz_events', 'updated_at'),
    probeTableMaxTimestamp(client, 'quiz_prize_reservations', 'updated_at'),
    probeTableMaxTimestamp(client, 'quiz_awards', 'expired_at'),
  ]);
  return {
    events: events ?? fallback,
    reservations: reservations ?? fallback,
    awards: awards ?? fallback,
  };
}

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
 * new watermark floors, so rows truncated by a single limited query would
 * never be revisited; pagination keeps every changed row covered. A
 * mid-sweep failure keeps the pages already collected but flags the sweep
 * incomplete — the run must conservatively invalidate instead of treating
 * the partial set as complete.
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
  watermarks: QuizSweepWatermarks
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
          .gte('updated_at', watermarks.events)
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
          .gte('updated_at', watermarks.reservations)
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
          .gte('expired_at', watermarks.awards)
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
      // Expired awards are absent from the `updated_at` event sweep (the
      // expiry RPC touches quiz_awards only), so an unmapped owner chunk
      // would drop its awards forever once the watermarks advance. Retry
      // once, then mark the run incomplete so collected merchants still
      // escalate to the hostname fallback.
      let ownerRows: QuizEventCacheRow[] | null = null;
      for (let attempt = 0; attempt < 2 && !ownerRows; attempt += 1) {
        try {
          const expiredEventResult = await client
            .from('quiz_events')
            .select('id, merchant_id')
            .in(
              'id',
              expiredEventIds.slice(start, start + QUIZ_EVENT_ID_CHUNK_SIZE)
            );
          if (!expiredEventResult.error) {
            ownerRows = (expiredEventResult.data ?? []) as QuizEventCacheRow[];
          }
        } catch {
          // Retried below; a persistent failure marks the run incomplete.
        }
      }
      if (!ownerRows) {
        sweepIncomplete = true;
        continue;
      }
      for (const row of ownerRows) {
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
      { watermarks }
    );
  }
  // Deliver in bounded-concurrency chunks: the worker has a 50s SIGTERM
  // budget and no delivery cursor, so serial per-merchant purges could die
  // with later merchants permanently unvisited. Each merchant is still
  // individually best-effort — a rejection never fails its chunk-mates.
  const merchantTargets = Array.from(productIdsByMerchant);
  for (
    let start = 0;
    start < merchantTargets.length;
    start += QUIZ_PURGE_MERCHANT_CONCURRENCY
  ) {
    await Promise.all(
      merchantTargets
        .slice(start, start + QUIZ_PURGE_MERCHANT_CONCURRENCY)
        .map(async ([merchantId, productIds]) => {
          try {
            await scheduleOrderProductBlogPurge({
              merchantId,
              productIds: Array.from(productIds),
              supabase: client,
              ...(sweepIncomplete ? { targetSweepIncomplete: true } : {}),
            });
          } catch {
            // The quiz RPC already completed; edge eviction stays best effort.
          }
        })
    );
  }
}
