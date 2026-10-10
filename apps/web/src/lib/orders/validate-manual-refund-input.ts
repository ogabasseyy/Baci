// Client-side manual-refund validation: fail fast with the same messages
// the server enforces, so merchants learn immediately instead of after
// a round trip. The RPC rechecks everything; this is UX only.
export function validateManualRefundInput({
  amount,
  date,
  remaining,
}: {
  amount: string;
  date: string;
  remaining: number | null;
}): string | null {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0)
    return 'Enter a valid refund amount greater than zero.';
  if (remaining !== null && parsedAmount > remaining)
    return 'Refund amount exceeds the remaining balance.';
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime()))
    return 'Enter a valid refund date and time.';
  if (parsedDate.getTime() > Date.now())
    return 'Refund date cannot be in the future.';
  return null;
}
