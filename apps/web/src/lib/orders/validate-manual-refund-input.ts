// Client-side manual-refund validation: fail fast with the same messages
// the server enforces, so merchants learn immediately instead of after
// a round trip. The RPC rechecks everything; this is UX only.
import { hasAtMostTwoDecimalPlaces } from './has-at-most-two-decimal-places';
import { toLagosRefundInstant } from './to-lagos-refund-instant';

export function validateManualRefundInput({
  amount,
  confirmed,
  date,
  method,
  paymentLegId,
  reference,
  remaining,
  requirePaymentLeg,
}: {
  amount: string;
  confirmed: boolean;
  date: string;
  method: string;
  paymentLegId?: string | null;
  reference: string;
  remaining: number | null;
  requirePaymentLeg?: boolean;
}): string | null {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return 'Enter a valid refund amount greater than zero.';
  // The RPC rejects amounts past two decimals; count off the
  // shortest round-trip text like the server schema (shared
  // helper), since a float epsilon false-rejects past ~1e8.
  if (!hasAtMostTwoDecimalPlaces(parsedAmount))
    return 'Enter the refund amount with at most two decimals.';
  if (remaining !== null && parsedAmount > remaining)
    return 'Refund amount exceeds the remaining balance.';
  // Evaluate the same Lagos-offset instant the panel submits, so a
  // viewer outside WAT gets the identical future verdict the server
  // computes from the stored string.
  const parsedDate = new Date(toLagosRefundInstant(date));
  if (Number.isNaN(parsedDate.getTime()))
    return 'Enter a valid refund date and time.';
  if (parsedDate.getTime() > Date.now())
    return 'Refund date cannot be in the future.';
  if (reference.trim() === '') return 'Enter the transfer reference.';
  if (reference.trim().length > 100)
    return 'Reference must be 100 characters or fewer.';
  if (
    method !== 'paystack' &&
    method !== 'bank_transfer' &&
    method !== 'cash' &&
    method !== 'other'
  )
    return 'Select how the money moved.';
  if (!confirmed) return 'Confirm that the money already moved.';
  // The RPC rejects an unpinned Paystack attestation when several
  // captures are outstanding: surface the choice here instead of
  // after a round trip. Sole legs resolve server-side on live data.
  if (requirePaymentLeg && !paymentLegId)
    return 'Select which Paystack capture this refund returns.';
  return null;
}
