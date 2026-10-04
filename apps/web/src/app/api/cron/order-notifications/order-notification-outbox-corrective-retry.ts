import type { createServiceClient } from '@/lib/supabase/service';
import {
  type OrderNotificationOutboxStatus,
  type OutboxStatusRow,
  updateOutboxStatus,
} from './order-notification-outbox-status';

const RETRY_BASE_DELAY_MS = 5 * 60 * 1000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;

type SupabaseClientLike = ReturnType<typeof createServiceClient>;

export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
}

// A rendered-field edit reset the marker post-acceptance, detected at the
// sender's lease check rather than during the sent transition: the customer
// holds a stale attachment and no further event requeues it, so this
// reserves a fresh corrective attempt past the provider-failure ceiling
// exactly like the reset error — routing it through the ordinary retry
// budget could terminally fail the row on its final attempt and silently
// drop the correction.
export function isPostAcceptanceLeaseReset(result: {
  status: string;
  error?: unknown;
}): boolean {
  return (
    result.status === 'failed' &&
    result.error === 'document_changed_during_send'
  );
}

// A concurrent edit landed between provider acceptance and the sent
// marker: the customer holds a stale attachment, but the trigger that
// caused the reset already fired, so no further event requeues the
// correction. Reserve a fresh corrective attempt instead of applying
// the provider-failure ceiling — failing here would silently drop a
// correction the customer never receives. The loop is self-limiting:
// without another concurrent edit the retry sends and terminalizes.
export async function markCorrectiveRetry(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow,
  summary: { retried: number },
  error = 'document_changed_during_send'
): Promise<void> {
  await updateOutboxStatus(supabase, row, {
    attempt_count: 0,
    last_error: error,
    next_attempt_at: new Date(Date.now() + retryDelayMs(0)).toISOString(),
    status: 'pending' satisfies OrderNotificationOutboxStatus,
  });
  summary.retried += 1;
}
