import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { CHECKOUT_API_BASE_URL } from './checkout-screen.constants';

export type CancelRedvaultOrderResult =
  | 'cancelled'
  | 'gone'
  | 'live'
  | 'failed';

/**
 * Cancels a REDVAULT order before the lane recreates or abandons it. The
 * tracking-token guest route serves guests and authed shoppers uniformly
 * whenever the proof is available; only legacy records persisted without a
 * token fall back to the session-bound account route. `cancelled`/`gone`
 * (either success value means no live order remains) release the lane;
 * `live` (409) means the checkout is already initializing and must replay
 * instead of duplicating.
 */
export async function cancelRedvaultOrder({
  orderId,
  reason,
  trackingToken,
}: {
  orderId: string;
  reason: string;
  trackingToken?: string;
}): Promise<CancelRedvaultOrderResult> {
  if (trackingToken) {
    try {
      const response = await fetch(
        `${CHECKOUT_API_BASE_URL}/api/storefront/orders/${orderId}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracking_token: trackingToken, reason }),
          signal: AbortSignal.timeout(10000),
        }
      );
      if (response.ok) return 'cancelled';
      if (response.status === 404) return 'gone';
      if (response.status === 409) return 'live';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
  try {
    await createStorefrontCustomerApiClient().fetchJson({
      body: { reason },
      method: 'POST',
      path: `/api/storefront/account/orders/${orderId}/cancel`,
    });
    return 'cancelled';
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'order_not_cancellable'
    ) {
      return 'live';
    }
    return 'failed';
  }
}
