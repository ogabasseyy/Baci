// Refund-panel visibility, shared by the order details page (which
// skips the server summary fetch when the panel cannot show) and the
// section itself (which hides the card). Single source so the two
// cannot drift: a mismatch in either direction degrades
// gracefully (unfetched-but-shown panels load client-side;
// fetched-but-hidden summaries are merely a wasted RPC).
export interface RefundPanelVisibilityOrder {
  paymentStatus: string;
  shippingStatus: string;
  transactions?: Array<{
    amount: number;
    status: string;
    transaction_type?: string;
  }>;
}

export function shouldShowOrderRefundPanel(
  order: RefundPanelVisibilityOrder
): boolean {
  // Paid scope: unfunded cancellations have no refundable balance, so
  // skip the card and its status polling rather than rendering a noisy
  // zero-balance Not started panel. Bnpl Approved is funded (Credit
  // Direct flips payment_status to bnpl_approved alongside paid), so
  // its cancellations need the same recovery actions when a refund
  // fails or needs manual recording. A Pending order can still be
  // funded (completed gateway legs the sweep never flipped to paid):
  // the server admits recovery whenever amount_paid > 0, so a payment
  // leg with moved money (completed, refund_pending mid-flight, or a
  // self-terminalized refunded leg the claim still finalizes) keeps
  // the panel visible and only truly unfunded orders hide it.
  if (!['Canceled', 'Cancelled'].includes(order.shippingStatus)) return false;
  // Unknown funding (transactions read failed server-side and was
  // logged) fails open: the panel's RPC is the real gate, and hiding
  // recovery on a transient read error strands funded orders.
  const hasFundedPaymentLeg =
    order.transactions === undefined ||
    order.transactions.some(
      (leg) =>
        leg.transaction_type === 'payment' &&
        (leg.status === 'completed' ||
          leg.status === 'refund_pending' ||
          leg.status === 'refunded') &&
        leg.amount > 0
    );
  return (
    ['Paid', 'Partially Paid', 'Refunded', 'Bnpl Approved'].includes(
      order.paymentStatus
    ) || hasFundedPaymentLeg
  );
}
