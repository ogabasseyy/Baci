import { EMAIL_ATTEMPTS_PER_SENDER } from '@/lib/orders/execute-customer-email-cancellation-side-effect';
import type { OrderCancellationSideEffectStep } from '@/lib/orders/run-order-cancellation-side-effect';
import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';

export interface CancellationDrainCandidateRow {
  attempts: number;
  claimed_at: string;
  order_id: string;
  step: OrderCancellationSideEffectStep;
}

/**
 * Merge the failed and deferred queues by age and fill one batch.
 * Deferred rows reselect uncapped and the claim RPC never increments
 * their attempts, but an already-exhausted deferred row must still run
 * as a last attempt: without the flag a 429 is recorded as an
 * ordinary failure the capped failed-queue never reselects, so the
 * leg disappears without its exhausted-rate-limit review. Merging by
 * age (ISO claimed_at sorts lexicographically) keeps a full failure
 * backlog from starving provider-awaiting refunds. Budget-ineligible
 * emails are filtered here so replacement candidates fill the batch;
 * the drain's per-row guard stays as the backstop since time keeps
 * burning while the batch runs.
 */
export function selectCancellationDrainCandidates({
  deadlineMs,
  deferredRows,
  failedRows,
  limit,
  maxAttempts,
}: {
  deadlineMs?: number;
  deferredRows: CancellationDrainCandidateRow[] | null;
  failedRows: CancellationDrainCandidateRow[] | null;
  limit: number;
  maxAttempts: number;
}): Map<string, CancellationDrainCandidateRow & { isLastAttempt: boolean }> {
  const candidates = new Map<
    string,
    CancellationDrainCandidateRow & { isLastAttempt: boolean }
  >();
  const merged: Array<
    CancellationDrainCandidateRow & { isLastAttempt: boolean }
  > = [
    ...(failedRows ?? []).map((row) => ({
      ...row,
      isLastAttempt: row.attempts >= maxAttempts - 1,
    })),
    ...(deferredRows ?? []).map((row) => ({
      ...row,
      isLastAttempt: row.attempts >= maxAttempts - 1,
    })),
  ].sort((a, b) =>
    a.claimed_at < b.claimed_at ? -1 : a.claimed_at > b.claimed_at ? 1 : 0
  );
  for (const row of merged) {
    if (
      row.step === 'customer_email' &&
      deadlineMs !== undefined &&
      deadlineMs - Date.now() <
        zeptomailSendAdmissionBudgetMs(EMAIL_ATTEMPTS_PER_SENDER)
    ) {
      continue;
    }
    candidates.set(`${row.order_id}:${row.step}`, row);
    if (candidates.size >= limit) break;
  }
  return candidates;
}
