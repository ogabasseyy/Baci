// Client-side manual-refund validation: fail fast with the same messages
// the server enforces, so merchants learn immediately instead of after
// a round trip. The RPC rechecks everything; this is UX only.
export function validateManualRefundInput({
  amount,
  confirmed,
  date,
  method,
  reference,
  remaining,
}: {
  amount: string;
  confirmed: boolean;
  date: string;
  method: string;
  reference: string;
  remaining: number | null;
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
  const parsedDate = new Date(date);
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
  return null;
}
