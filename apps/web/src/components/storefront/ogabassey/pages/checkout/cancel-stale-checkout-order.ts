import { fetchWithCsrf } from '@/lib/api-client';

export type CancelStaleCheckoutOrderResult =
  | 'cancelled'
  | 'gone'
  | 'live'
  | 'failed';

type CancelFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Cancels a stale checkout order before the lane recreates it: an ordinary
 * order abandoned for REDVAULT, or a prepared REDVAULT order whose checkout
 * inputs changed. Authenticated shoppers use the account route; guests use
 * the tracking-token route (a guest without a token cannot prove ownership).
 * An authenticated 404 falls back to the token route when a token is
 * available: the stored order may predate the session (guest-owned), and
 * declaring it gone would open a second order while it still holds
 * inventory.
 *
 * Only an authenticated 404 proves absence. An unauthenticated guest-route
 * 404 stays failed: the order may have been attached after signup (the
 * guest RPC only matches `user_id IS NULL`) and a sign-out preserves the
 * fence, so treating it as gone would clear the fence while the attached
 * order and hosted payment remain live. `cancelled`/`gone` (either cancel
 * response value means no live order remains) release the lane; `live`
 * (409) means the previous checkout is already initializing and must
 * replay instead of duplicating.
 */
export async function cancelStaleCheckoutOrder({
  isAuthenticated,
  orderId,
  reason,
  trackingToken,
  accountFetch = fetchWithCsrf,
  guestFetch = fetch,
}: {
  isAuthenticated: boolean;
  orderId: string;
  reason: string;
  trackingToken?: string;
  accountFetch?: CancelFetch;
  guestFetch?: CancelFetch;
}): Promise<CancelStaleCheckoutOrderResult> {
  try {
    if (isAuthenticated) {
      const response = await accountFetch(
        `/api/storefront/account/orders/${orderId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      );
      if (response.ok) return 'cancelled';
      if (response.status === 409) return 'live';
      if (response.status !== 404) return 'failed';
      if (!trackingToken) return 'gone';
      // Account route found nothing but a token is available: retry as a
      // pre-session guest order before declaring the fence clear.
    }
    if (!trackingToken) return 'failed';
    const response = await guestFetch(
      `/api/storefront/orders/${orderId}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_token: trackingToken, reason }),
      }
    );
    if (response.ok) return 'cancelled';
    if (response.status === 409) return 'live';
    if (response.status === 404) {
      // An attached order 404s on the guest route; without a session that
      // absence is unprovable, so only an authenticated caller may treat
      // it as gone.
      return isAuthenticated ? 'gone' : 'failed';
    }
    return 'failed';
  } catch {
    return 'failed';
  }
}
