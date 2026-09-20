import { useEffect, useState } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';

const GUEST_INVOICE_LOOKUP_TIMEOUT_MS = 15_000;

function toTrackedOrder(value: unknown): TrackOrderData['order'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const order = (value as { order?: unknown }).order;
  if (!order || typeof order !== 'object') {
    return null;
  }
  return order as TrackOrderData['order'];
}

// Resolves the paid state for guest invoice orders. The authenticated
// receipt-detail query is disabled without a signed-in user, so a guest
// returning through the tracking token would otherwise always see proforma
// copy even after external payment. A single token-scoped lookup is enough:
// it serves the returning (already settled) shopper, not live polling.
export function useGuestInvoicePaidState({
  orderId,
  paymentMethod,
  trackingToken,
  skip,
}: {
  orderId?: string;
  paymentMethod?: string;
  trackingToken?: string;
  skip: boolean;
}): boolean {
  const [isPaid, setIsPaid] = useState(false);
  useEffect(() => {
    // The paid flag belongs to one lookup identity: same-route navigation
    // or a new deep link can swap a paid guest invoice for a different
    // unpaid one on the mounted route, and the new lookup must not
    // inherit the previous order's paid presentation (receipt/commercial
    // copy for an unpaid order).
    setIsPaid(false);
    if (skip || paymentMethod !== 'invoice' || !orderId || !trackingToken) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GUEST_INVOICE_LOOKUP_TIMEOUT_MS
    );
    void (async () => {
      try {
        const response = await fetch(
          `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
          { signal: controller.signal }
        );
        if (!response.ok || cancelled) {
          return;
        }
        const order = toTrackedOrder(await response.json());
        if (order && order.id === orderId && order.payment_status === 'paid') {
          setIsPaid(true);
        }
      } catch {
        // Display stays proforma; the shopper can still pay or retry.
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [skip, orderId, paymentMethod, trackingToken]);
  return isPaid;
}
