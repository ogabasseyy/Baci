import { readCreditDirectAttempt } from './credit-direct-attempt';
import type { StuckBnplOrderRow } from './stuck-bnpl-alert';

function hasMatchingProviderReference(
  provider: string | null,
  notes: string | null
) {
  if (!notes || (provider !== 'klump' && provider !== 'credpal')) return false;
  try {
    const parsed: unknown = JSON.parse(notes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return false;
    const fields = parsed as Record<string, unknown>;
    return [
      fields[`${provider}TransactionId`],
      fields[`${provider}_transaction_id`],
    ].some((value) => typeof value === 'string' && value.trim().length > 0);
  } catch {
    return false;
  }
}

/** Classifies checkout evidence separately from evidence that merits a push. */
export function getStuckBnplSignals(
  order: Pick<StuckBnplOrderRow, 'notes' | 'payment_method' | 'payment_status'>
) {
  const provider = order.payment_method?.trim().toLowerCase() ?? null;
  const attempt = readCreditDirectAttempt(order.notes);
  const hasCheckoutEvidence =
    provider === 'credit_direct'
      ? attempt.reference !== null || attempt.hasCompletionTimestamp
      : hasMatchingProviderReference(provider, order.notes);
  const hasConfirmation =
    order.payment_status === 'bnpl_approved' ||
    (provider === 'credit_direct' && attempt.hasCurrentCompletion);

  // Klump and CredPal do not report SDK completion. Their checkout
  // reference can stand in for an SDK completion signal.
  const shouldAlert =
    hasConfirmation ||
    ((provider === 'klump' || provider === 'credpal') && hasCheckoutEvidence);

  return {
    provider,
    attempt,
    hasCheckoutEvidence,
    hasConfirmation,
    shouldAlert,
  };
}
