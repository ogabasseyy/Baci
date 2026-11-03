type StatusFetch = (url: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Verify an owned order's terminal state before releasing a recovery fence. */
export async function verifyCancelledRedvaultOrder({
  orderId,
  merchantId,
  merchantSlug,
  trackingToken,
  fetchImpl,
}: {
  orderId: string;
  merchantId?: string;
  merchantSlug?: string | null;
  trackingToken?: string;
  fetchImpl: StatusFetch;
}): Promise<boolean> {
  if (!orderId || !merchantId || !trackingToken) return false;
  const query = new URLSearchParams({ tracking_token: trackingToken });
  if (merchantSlug) query.set('merchant_slug', merchantSlug);
  try {
    const response = await fetchImpl(
      `/api/storefront/orders/${encodeURIComponent(orderId)}?${query.toString()}`,
      { cache: 'no-store' }
    );
    if (!response.ok) return false;
    const order: unknown = await response.json();
    if (!isRecord(order)) return false;
    const paidAmount = order.amount_paid;
    const hasNoPaidAmount =
      (typeof paidAmount === 'number' && paidAmount === 0) ||
      (typeof paidAmount === 'string' &&
        paidAmount.trim() !== '' &&
        Number(paidAmount) === 0);
    return (
      order.id === orderId &&
      order.merchant_id === merchantId &&
      order.payment_method === 'uba_redvault' &&
      order.payment_status === 'cancelled' &&
      order.shipping_status === 'cancelled' &&
      hasNoPaidAmount
    );
  } catch {
    return false;
  }
}
