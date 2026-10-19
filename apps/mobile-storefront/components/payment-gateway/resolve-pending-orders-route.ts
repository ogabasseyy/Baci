import type { Href } from 'expo-router';

/**
 * Destination for the pending-payment "View your orders" action. The
 * order details route requires an authenticated user + customer, so a
 * guest without an account routes to the tracking-token status view
 * (which this flow already carries) instead of a sign-in error.
 */
export function resolvePendingOrdersRoute({
  customerId,
  orderId,
  trackingToken,
  userId,
}: {
  customerId: string | undefined;
  orderId: string | undefined;
  trackingToken: string | undefined;
  userId: string | undefined;
}): Href {
  if (userId && customerId) {
    return orderId ? `/orders/${orderId}` : '/orders';
  }
  if (trackingToken) {
    return { pathname: '/track-order', params: { trackingToken } };
  }
  return '/orders';
}
