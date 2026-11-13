import 'server-only';
import { runGoalCancelReconciliation } from './goal-cancel-reconciliation';
import type { createGoalCancelStore } from './goal-cancel-store';

type GoalCancelStore = ReturnType<typeof createGoalCancelStore>;

// A settlement conflict is never shown as released or as a plain wait: the
// provider moved the money, so the customer is told it is under review and an
// operator has already been paged (see the evidence store).
export function publicStatus(outcome: {
  status: 'confirmed' | 'cancelled' | 'pending';
  needsReview?: boolean;
}) {
  if (outcome.needsReview === true && outcome.status === 'pending')
    return { status: 'needs_review' } as const;
  return outcome.status === 'cancelled'
    ? ({ status: 'released' } as const)
    : ({ status: outcome.status } as const);
}

/**
 * Status check for a cancel: the only thing a retry does. It reads our record
 * and asks PiggyVest (TSQ) about the deterministic reference; it never posts.
 */
export async function readGoalCancelStatus(
  store: Pick<GoalCancelStore, 'readStatus' | 'cancelStaleReservation'>,
  evidence: unknown,
  token: string,
  operationId: string
) {
  let state = await store.readStatus(operationId);
  if (state === 'reserved') {
    // Nothing was sent for a reserved attempt; only a stale one is released
    // (a live submission holds it for seconds between reserve and dispatch).
    await store.cancelStaleReservation(operationId).catch(() => undefined);
    state = await store.readStatus(operationId);
  }
  if (state === null) return { status: 'not_found' as const };
  if (state === 'confirmed') return { status: 'confirmed' as const };
  // Review is its own recorded state, whichever path (webhook or poll) settled
  // it first: it is never reported as a completed cancellation. Once an
  // operator has cleared it the refund itself is done, so it reads confirmed.
  if (state === 'needs_review') return { status: 'needs_review' as const };
  if (state === 'reviewed') return { status: 'confirmed' as const };
  if (state === 'released') {
    // A released attempt that WAS dispatched can still turn out to have
    // succeeded at the provider (indexed late). Re-check it: a verified
    // success settles it, anything else leaves it released.
    try {
      const outcome = await runGoalCancelReconciliation({
        configuration: evidence,
        providerToken: token,
        operationId,
      });
      if (outcome.status === 'confirmed')
        return { status: 'confirmed' as const };
      if (outcome.needsReview === true)
        return { status: 'needs_review' as const };
    } catch {
      // The status answer below is still the recorded state.
    }
    return { status: 'released' as const };
  }
  if (state === 'issued') return { status: 'not_started' as const };
  if (state === 'reserved') return { status: 'pending' as const };
  return publicStatus(
    await runGoalCancelReconciliation({
      configuration: evidence,
      providerToken: token,
      operationId,
    })
  );
}
