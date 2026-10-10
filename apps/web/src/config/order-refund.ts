export const orderRefundStatusLabels: Record<string, string> = {
  refunded: 'Refunded',
  processing: 'Processing',
  requires_review: 'Requires review',
  queued: 'Queued',
  failed: 'Failed',
  not_started: 'Not started',
  claimed: 'Processing',
  completed: 'Refund completed',
  delivery_uncertain: 'Requires review',
  existing_state: 'Previous refund status',
  retry_requested: 'Retry requested',
  manual_recorded: 'Manual refund recorded',
  provider_confirmed: 'Refund confirmed',
};

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

// canManageRefunds conflates "no permission" with "step busy": a
// permitted merchant viewing a claimed or delivery_uncertain step
// must see a waiting explanation, not a permission error.
export function describeRefundManageBlocked(status: string): string {
  if (status === 'processing')
    return 'Refund is being processed. Retry and manual recording unlock when it settles.';
  if (status === 'requires_review')
    return 'Refund is under review. Retry and manual recording unlock when review clears.';
  return 'You need refund permission to retry or record refunds.';
}
