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
