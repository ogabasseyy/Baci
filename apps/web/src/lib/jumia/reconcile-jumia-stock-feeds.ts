import type { SupabaseClient } from '@supabase/supabase-js';
import type { JumiaClient } from '@/lib/jumia/client';
import { getFeedStatus } from '@/lib/jumia/feeds';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { MAX_FEEDS_PER_REQUEST } from '@/lib/jumia/jumia-feed-reconciliation-batch';
import {
  isAcceptedFeedStatus,
  isFailedFeedStatus,
} from '@/lib/jumia/jumia-feed-status-normalization';
import type { JumiaStockMapping } from '@/lib/jumia/load-jumia-stock-mappings';
import { logger } from '@/lib/logger';

export interface JumiaStockFeedReconciliation {
  feedsChecked: number;
  cursorsReset: number;
  feedsConfirmed: number;
  failures: number;
}

/**
 * Reconciles previously accepted Jumia stock feeds before the next push.
 *
 * Stock tracking advances its cursor the moment Jumia accepts a feed, but feed
 * processing is asynchronous: a later rejection would leave the cursor ahead
 * of Jumia's actual stock forever, because delta detection skips mappings
 * whose local stock already equals the cursor. Feed-status reconciliation only
 * loads `sync_status = 'pending'` mappings, so it never sees these already
 * synced stock mappings.
 *
 * This runs at the start of every stock sync (manual and scheduled):
 * - rejected feeds reset the stock cursor to NULL so the mapping is retried;
 * - accepted feeds clear `last_feed_id` so they are not re-checked, but
 *   rejected items inside an accepted feed still reset their cursor;
 * - missing (404) feeds reset the cursor: the outcome is unknowable and
 *   replaying an absolute stock value is idempotent;
 * - transient lookup failures and still-processing feeds are left untouched.
 *
 * Reset mappings are patched in place so the caller re-pushes them in the
 * same run. Never throws: reconciliation must not block the stock sync.
 */

/**
 * Selects the bounded feed window for one sync, rotating the starting offset
 * by a full batch per UTC day. A fixed head slice would let stuck
 * lookup-error feeds starve newer feeds forever, and a one-position daily
 * stride would take hundreds of days to reach the tail; rotation by `limit`
 * inspects every outstanding feed over time without persisting a cursor.
 */
function isMissingFeedLookup(error: unknown): boolean {
  if (error instanceof JumiaApiError) return error.status === 404;
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

export function selectStockFeedIdsForReconciliation(
  feedIds: readonly string[],
  limit: number,
  nowMs: number
): string[] {
  const ordered = [...new Set(feedIds)].sort();
  if (ordered.length <= limit) return ordered;
  const stride = Math.max(1, limit);
  const offset = (Math.floor(nowMs / 86_400_000) * stride) % ordered.length;
  return Array.from(
    { length: limit },
    (_, index) => ordered[(offset + index) % ordered.length] as string
  );
}
export async function reconcileJumiaStockFeeds(
  supabase: SupabaseClient,
  client: JumiaClient,
  args: { mappings: JumiaStockMapping[] }
): Promise<JumiaStockFeedReconciliation> {
  const result: JumiaStockFeedReconciliation = {
    feedsChecked: 0,
    cursorsReset: 0,
    feedsConfirmed: 0,
    failures: 0,
  };
  // Only mappings with an advanced cursor can be stuck: NULL-cursor mappings
  // always push, and mappings without a feed were never pushed.
  const candidates = args.mappings.filter(
    (mapping) =>
      mapping.last_feed_id && mapping.baci_stock_at_last_sync !== null
  );
  if (candidates.length === 0) return result;

  const feedIds = selectStockFeedIdsForReconciliation(
    candidates.map((mapping) => mapping.last_feed_id as string),
    MAX_FEEDS_PER_REQUEST,
    Date.now()
  );

  for (const feedId of feedIds) {
    const mappingsForFeed = candidates.filter(
      (mapping) => mapping.last_feed_id === feedId
    );
    let feed: Awaited<ReturnType<typeof getFeedStatus>>;
    try {
      feed = await getFeedStatus(client, feedId);
    } catch (error) {
      if (isMissingFeedLookup(error)) {
        // Retention expiry: the feed is gone and a rejected absolute stock
        // value would never be resubmitted if the cursor were preserved.
        // Replaying the absolute value is idempotent, so reset it.
        logger.warn({
          message: 'Resetting Jumia stock cursor after missing feed lookup',
          error: error instanceof Error ? error.message : 'Unknown error',
          feed_id: feedId,
        });
        for (const mapping of mappingsForFeed) {
          tallyStockCursorWrite(
            result,
            await resetStockCursor(supabase, mapping, feedId),
            'cursorsReset'
          );
        }
        result.feedsChecked++;
        continue;
      }
      // Unknown transient outcome (transport blip): leave the cursor so a
      // failing lookup can never force a duplicate push.
      logger.warn({
        message:
          'Skipping Jumia stock feed reconciliation after lookup failure',
        error: error instanceof Error ? error.message : 'Unknown error',
        feed_id: feedId,
      });
      continue;
    }
    result.feedsChecked++;

    if (
      isFailedFeedStatus(feed.status) ||
      (feed.feedItems.length === 0 && feed.failed > 0)
    ) {
      for (const mapping of mappingsForFeed) {
        tallyStockCursorWrite(
          result,
          await resetStockCursor(supabase, mapping, feedId),
          'cursorsReset'
        );
      }
      continue;
    }

    // Settle terminal items first: an overall 'completed' feed can still
    // carry rejected items, and confirming those mappings would strand the
    // rejected SKU's advanced cursor.
    for (const item of feed.feedItems) {
      const mapping = mappingsForFeed.find(
        (candidate) =>
          candidate.last_feed_id === feedId &&
          candidate.jumia_seller_sku === item.sellerSKU
      );
      if (!mapping) continue;
      if (isFailedFeedStatus(item.status)) {
        tallyStockCursorWrite(
          result,
          await resetStockCursor(supabase, mapping, feedId),
          'cursorsReset'
        );
      } else if (isAcceptedFeedStatus(item.status)) {
        tallyStockCursorWrite(
          result,
          await confirmStockFeed(supabase, mapping, feedId),
          'feedsConfirmed'
        );
      }
    }

    if (isAcceptedFeedStatus(feed.status)) {
      // Feed-level success settles the remainder; mappings settled above no
      // longer carry this feed id.
      for (const mapping of mappingsForFeed) {
        if (mapping.last_feed_id !== feedId) continue;
        tallyStockCursorWrite(
          result,
          await confirmStockFeed(supabase, mapping, feedId),
          'feedsConfirmed'
        );
      }
    }
    // Otherwise the feed is still processing: pending mappings keep their
    // feed id for the next run.
  }

  return result;
}

type StockCursorWriteOutcome = 'applied' | 'stale' | 'failed';

function tallyStockCursorWrite(
  result: JumiaStockFeedReconciliation,
  outcome: StockCursorWriteOutcome,
  appliedKey: 'cursorsReset' | 'feedsConfirmed'
): void {
  if (outcome === 'applied') {
    result[appliedKey] += 1;
  } else if (outcome === 'failed') {
    result.failures += 1;
  }
  // 'stale': a concurrent run already recorded a newer feed on this
  // mapping; leave it alone so the newer feed is reconciled in turn.
}

async function resetStockCursor(
  supabase: SupabaseClient,
  mapping: JumiaStockMapping,
  feedId: string
): Promise<StockCursorWriteOutcome> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .update({
      baci_stock_at_last_sync: null,
      last_stock_synced_at: null,
      last_feed_id: null,
    })
    .eq('id', mapping.id)
    .eq('last_feed_id', feedId)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    logger.error({
      message: 'Failed to reset rejected Jumia stock cursor',
      error,
      mapping_id: mapping.id,
    });
    return 'failed';
  }
  if (!data) return 'stale';
  mapping.baci_stock_at_last_sync = null;
  mapping.last_feed_id = null;
  return 'applied';
}

async function confirmStockFeed(
  supabase: SupabaseClient,
  mapping: JumiaStockMapping,
  feedId: string
): Promise<StockCursorWriteOutcome> {
  const { data, error } = await supabase
    .from('jumia_product_mappings')
    .update({ last_feed_id: null })
    .eq('id', mapping.id)
    .eq('last_feed_id', feedId)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    logger.error({
      message: 'Failed to confirm Jumia stock feed',
      error,
      mapping_id: mapping.id,
    });
    return 'failed';
  }
  if (!data) return 'stale';
  mapping.last_feed_id = null;
  return 'applied';
}
