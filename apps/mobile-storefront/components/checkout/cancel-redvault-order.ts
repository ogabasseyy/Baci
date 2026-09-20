import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { CHECKOUT_API_BASE_URL } from './checkout-screen.constants';

export type CancelRedvaultOrderResult =
  | 'cancelled'
  | 'gone'
  | 'live'
  | 'failed';

const AUTH_REQUIRED_MESSAGE = 'Authentication required. Please sign in again.';
const ORDER_NOT_FOUND_MESSAGE = 'Order not found';

function isLiveCancelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'order_not_cancellable'
  );
}

function isNotFoundCancelError(error: unknown): boolean {
  return error instanceof Error && error.message === ORDER_NOT_FOUND_MESSAGE;
}

function isAuthRequiredCancelError(error: unknown): boolean {
  return error instanceof Error && error.message === AUTH_REQUIRED_MESSAGE;
}

async function cancelViaAccountRoute({
  orderId,
  reason,
}: {
  orderId: string;
  reason: string;
}): Promise<void> {
  await createStorefrontCustomerApiClient().fetchJson({
    body: { reason },
    method: 'POST',
    path: `/api/storefront/account/orders/${orderId}/cancel`,
  });
}

/**
 * Cancels a REDVAULT order before the lane recreates or abandons it. The
 * tracking-token guest route serves guests and authed shoppers uniformly
 * whenever the proof is available; only legacy records persisted without a
 * token go straight to the session-bound account route.
 *
 * A guest-route 404 does NOT mean the order is gone: choosing save-details
 * attaches the order to the shopper's account (`customers.user_id`), which
 * the guest RPC (`user_id IS NULL`) no longer matches. The account route is
 * retried before declaring the order gone — otherwise dismissal and resubmit
 * recovery would clear the fence while the order (and an indeterminate
 * provider attempt) stays live. `cancelled`/`gone` (either success value
 * means no live order remains) release the lane; `live` (409) means the
 * checkout is already initializing and must replay instead of duplicating.
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
      if (response.status === 409) return 'live';
      if (response.status !== 404) return 'failed';
    } catch {
      return 'failed';
    }
    // Guest route found nothing: the order may have been attached to the
    // shopper's account after signup. Retry authenticated before gone.
    // No session means this shopper owns no attached order, so the guest
    // 404 stands; any other account failure stays failed (never gone).
    try {
      await cancelViaAccountRoute({ orderId, reason });
      return 'cancelled';
    } catch (error) {
      if (isLiveCancelError(error)) return 'live';
      if (isNotFoundCancelError(error) || isAuthRequiredCancelError(error)) {
        return 'gone';
      }
      return 'failed';
    }
  }
  try {
    await cancelViaAccountRoute({ orderId, reason });
    return 'cancelled';
  } catch (error) {
    if (isLiveCancelError(error)) {
      return 'live';
    }
    // Legacy record with no owned order: nothing live remains, so the lane
    // is released. Auth failures stay failed — without a session the
    // account route proves nothing either way.
    if (isNotFoundCancelError(error)) {
      return 'gone';
    }
    return 'failed';
  }
}
