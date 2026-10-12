// Client-side manual-refund validation: fail fast with the same messages
// the server enforces, so merchants learn immediately instead of after
// a round trip. The RPC rechecks everything; this is UX only.
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
  // The RPC rejects amounts that are not exact to two decimals; compare
  // in float with an epsilon so binary error on tight values (10.29)
  // passes while a genuine third decimal (10.291) still fails.
  if (Math.abs(parsedAmount * 100 - Math.round(parsedAmount * 100)) > 1e-6)
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
