import type { SupabaseClient } from '@supabase/supabase-js';
import { JumiaApiError } from '@/lib/jumia/helpers';
import type { PendingFeedMapping } from '@/lib/jumia/jumia-feed-reconciliation-batch';
import { logger } from '@/lib/logger';
import { AMBIGUOUS_JUMIA_EXPORT_ERROR } from '../export/mark-ambiguous-jumia-export';
import { jumiaFeedReconciliation } from './jumia-feed-reconciliation';

type FeedLookupFailureResult =
  | {
      kind: 'continue';
      failed: number;
      status: 'NOT_FOUND' | 'ERROR';
      feedFailed: number;
      preservedForManualResolution: Array<{
        mappingId: string;
        sellerSku: string | null;
      }>;
    }
  | { kind: 'response'; response: Response };

function hasStatus(error: unknown, status: number): boolean {
  if (error instanceof JumiaApiError) return error.status === status;
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === status
  );
}

/** Records a feed lookup failure without preventing later feeds from running. */
export async function handleJumiaFeedLookupFailure(args: {
  error: unknown;
  feedId: string;
  mappingsForFeed: PendingFeedMapping[];
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<FeedLookupFailureResult> {
  const isMissingFeedLookup = hasStatus(args.error, 404);
  if (isMissingFeedLookup && args.mappingsForFeed.length > 0) {
    try {
      // A 404 does not prove rejection: an accepted feed ages out of Jumia's
      // retention window. Marking these mappings as error would let the
      // export reservation delete them and submit a duplicate create feed,
      // so preserve them as ambiguous pending manual resolution instead.
      await jumiaFeedReconciliation.markMappingsAsPendingForManualResolution(
        args.supabase,
        args.merchantId,
        args.mappingsForFeed,
        AMBIGUOUS_JUMIA_EXPORT_ERROR
      );
      logger.error({
        message: 'Failed to read Jumia feed status',
        error: args.error,
        feed_id: args.feedId,
      });
      return {
        kind: 'continue',
        failed: 0,
        status: 'NOT_FOUND',
        feedFailed: 0,
        preservedForManualResolution: args.mappingsForFeed.map((mapping) => ({
          mappingId: mapping.id,
          sellerSku: mapping.jumia_seller_sku,
        })),
      };
    } catch (markError) {
      logger.error({
        message: 'Failed to preserve missing Jumia product feed',
        error: markError,
        feed_id: args.feedId,
      });
      return {
        kind: 'response',
        response: Response.json(
          { error: 'Failed to reconcile missing Jumia product feed' },
          { status: 500 }
        ),
      };
    }
  }

  logger.error({
    message: 'Failed to read Jumia feed status',
    error: args.error,
    feed_id: args.feedId,
  });
  return {
    kind: 'continue',
    failed: 0,
    status: 'ERROR',
    feedFailed: 0,
    preservedForManualResolution: [],
  };
}
