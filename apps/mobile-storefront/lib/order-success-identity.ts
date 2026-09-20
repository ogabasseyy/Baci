export interface OrderSuccessIdentity {
  orderId?: string;
  orderNumber?: string;
  reference?: string;
}

/**
 * Whether the order-success route carries a completed-order identity. Deep
 * links or stale routes without one must not schedule the post-purchase
 * interstitial: presenting would burn the once-per-session cap with no
 * completed order behind it.
 */
export function hasOrderSuccessIdentity({
  orderId,
  orderNumber,
  reference,
}: OrderSuccessIdentity): boolean {
  return Boolean(orderId?.trim() || orderNumber?.trim() || reference?.trim());
}
