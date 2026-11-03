import type { createServiceClient } from '@/lib/supabase/service';
import {
  markCorrectiveRetry,
  retryDelayMs,
} from './order-notification-outbox-corrective-retry';
import {
  type OrderNotificationOutboxStatus,
  type OutboxStatusRow,
  updateOutboxStatus,
} from './order-notification-outbox-status';

type SupabaseClientLike = ReturnType<typeof createServiceClient>;

export interface FailedOrRetryRow extends OutboxStatusRow {
  attempt_count: number;
  max_attempts: number;
}

export interface FailedOrRetrySummary {
  failed: number;
  retried: number;
  skipped: number;
}

export async function markFailedOrRetry(
  supabase: SupabaseClientLike,
  row: FailedOrRetryRow,
  error: string,
  summary: FailedOrRetrySummary
) {
  // Counts follow the durable write: a superseded attempt (lost claim)
  // must not count an outcome the row never recorded.
  // A failed marker cleanup strands past the budget (the set marker
  // blocks re-arm): corrective-retry like a lease reset instead.
  if (error === 'dispatch_marker_clear_failed') {
    await markCorrectiveRetry(supabase, row, summary, error);
    return;
  }
  // A transient reclaim-read failure must not overwrite the row's
  // established last_error: when a prior attempt stranded its marker
  // (last_error 'dispatch_marker_clear_failed'), persisting the read blip
  // would destroy the reclaim sentinel, and the next attempt would no
  // longer recognize the row as reclaimable — terminalizing an unsent
  // document. Retry on the ordinary budget with the prior evidence
  // intact instead.
  const preserveLastError = error.startsWith(
    'dispatch_marker_reclaim_read_failed'
  );
  if (row.attempt_count >= row.max_attempts) {
    await updateOutboxStatus(supabase, row, {
      ...(preserveLastError ? {} : { last_error: error }),
      next_attempt_at: null,
      status: 'failed' satisfies OrderNotificationOutboxStatus,
    });
    summary.failed += 1;
    return;
  }

  await updateOutboxStatus(supabase, row, {
    ...(preserveLastError ? {} : { last_error: error }),
    next_attempt_at: new Date(
      Date.now() + retryDelayMs(row.attempt_count)
    ).toISOString(),
    status: 'pending' satisfies OrderNotificationOutboxStatus,
  });
  summary.retried += 1;
}
