import { readCreditDirectAttempt } from './credit-direct-attempt';
import type { StuckBnplOrderRow } from './stuck-bnpl-alert';

/** Classifies checkout evidence separately from evidence that merits a push. */
export function getStuckBnplSignals(
  order: Pick<StuckBnplOrderRow, 'notes' | 'payment_method' | 'payment_status'>
) {
  const provider = order.payment_method?.trim().toLowerCase() ?? null;
  const attempt = readCreditDirectAttempt(order.notes);
  const hasCheckoutEvidence =
    Boolean(order.notes && /transactionid/i.test(order.notes)) ||
    attempt.reference !== null ||
    attempt.hasCompletionTimestamp;
  const hasConfirmation =
    order.payment_status === 'bnpl_approved' ||
    (provider === 'credit_direct' && attempt.hasCurrentCompletion);

  // Klump and CredPal do not report SDK completion. Keep their existing
  // alert behavior after the scan's checkout-evidence filter.
  const shouldAlert =
    hasConfirmation || provider === 'klump' || provider === 'credpal';

  return {
    provider,
    attempt,
    hasCheckoutEvidence,
    hasConfirmation,
    shouldAlert,
  };
}
