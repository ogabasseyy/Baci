// Boundary mapping for worker/provider strings, shared by the refund
// route: map each family to a fixed label so raw text never reaches
// API consumers. Unknown messages fall through to the generic label,
// never to the raw string. Not idempotent by design (a mapped label
// re-enters as unknown), so callers map once, at the boundary.
export function describeRefundWorkerError(message: string): string {
  if (message.startsWith('cancellation_refund_awaiting_'))
    return 'Refund in progress — waiting for the remaining money to arrive.';
  const lowered = message.toLowerCase();
  if (
    lowered.includes('requires review') ||
    lowered.includes('review required') ||
    lowered.includes('reconciliation')
  )
    return 'This refund needs review before it can continue.';
  return 'The refund ran into a problem. Support has the details.';
}
