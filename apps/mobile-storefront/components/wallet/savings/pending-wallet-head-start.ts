import { boundedMapSet } from '@/lib/bounded-map-set';

/** Plans remembered at once; the oldest is forgotten first. */
const MAX_PENDING_HEAD_STARTS = 16;

/**
 * Head starts the customer chose to pay from their wallet when creating a
 * plan, keyed by goal. The money cannot move until the plan's own savings
 * wallet exists (about a minute after creation), so the plan sheet reads this
 * once the plan is ready and offers one "Move ₦X from my wallet" button
 * instead of the amount entry. Money moves only on the customer's tap, never
 * by itself.
 *
 * It lives only for this app run and holds no money or personal data, just a
 * goal id and a whole-naira amount. Losing it (app restart) only means the
 * customer adds the head start by hand from the sheet, as before.
 */
const pending = new Map<string, number>();

export function rememberWalletHeadStart(goalId: string, amount: number) {
  if (!goalId || !Number.isSafeInteger(amount) || amount <= 0) return;
  boundedMapSet(pending, goalId, amount, MAX_PENDING_HEAD_STARTS);
}

/** The head start still waiting to move for this goal, or null. */
export function pendingWalletHeadStart(goalId: string): number | null {
  return pending.get(goalId) ?? null;
}

/**
 * Removes and returns the waiting head start, so only one caller ever starts
 * the transfer for it.
 */
export function takeWalletHeadStart(goalId: string): number | null {
  const amount = pending.get(goalId) ?? null;
  pending.delete(goalId);
  return amount;
}
