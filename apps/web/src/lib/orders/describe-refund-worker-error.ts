// Worker error strings bypass the API's fixed-message allowlist, so the
// panel never renders them verbatim: map each family to a fixed label
// and keep the raw text in the element title for support. Unknown
// messages fall through to the generic label, never to the raw string.
export function describeRefundWorkerError(message: string): string {
  if (message.startsWith('cancellation_refund_awaiting_'))
    return 'Refund in progress — waiting for the remaining money to arrive.';
  if (
    message.includes('requires review') ||
    message.includes('review required') ||
    message.includes('reconciliation')
  )
    return 'This refund needs review before it can continue.';
  return 'The refund ran into a problem. Support has the details.';
}
