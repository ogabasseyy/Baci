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
// correction the customer never receives.
export const MAX_CORRECTIVE_ATTEMPTS = 3;

const CORRECTIVE_ATTEMPTS_METADATA_KEY = 'corrective_attempts';

function readCorrectiveAttempts(row: {
  metadata?: Record<string, unknown>;
}): number {
  const raw = row.metadata?.[CORRECTIVE_ATTEMPTS_METADATA_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export async function markCorrectiveRetry(
  supabase: SupabaseClientLike,
  row: OutboxStatusRow & { metadata?: Record<string, unknown> },
  summary: { retried: number; skipped: number },
  error = 'document_changed_during_send'
): Promise<void> {
  const correctiveAttempts = readCorrectiveAttempts(row) + 1;

  // Poison-row fence: a recurring marker reset (a repeatedly touched
  // rendered field or a staff integration that keeps updating the order)
  // would otherwise re-send a fresh corrective email every cycle with the
  // attempt budget perpetually reset. Past the budget the row terminalizes
  // as delivery_outcome_unknown — the established indeterminate terminal —
  // instead of duplicating forever.
  if (correctiveAttempts > MAX_CORRECTIVE_ATTEMPTS) {
    await updateOutboxStatus(supabase, row, {
      last_error: 'corrective_attempt_budget_exhausted',
      next_attempt_at: null,
      skip_reason: 'delivery_outcome_unknown',
      skipped_at: new Date().toISOString(),
      status: 'skipped' satisfies OrderNotificationOutboxStatus,
    });
    summary.skipped += 1;
    return;
  }

  await updateOutboxStatus(supabase, row, {
    attempt_count: 0,
    last_error: error,
    // Merge over the claimed snapshot: the claim holder is the only writer,
    // so no concurrent metadata edit from another worker is possible here.
    metadata: {
      ...(row.metadata ?? {}),
      [CORRECTIVE_ATTEMPTS_METADATA_KEY]: correctiveAttempts,
    },
    next_attempt_at: new Date(Date.now() + retryDelayMs(0)).toISOString(),
    status: 'pending' satisfies OrderNotificationOutboxStatus,
  });
  summary.retried += 1;
}
