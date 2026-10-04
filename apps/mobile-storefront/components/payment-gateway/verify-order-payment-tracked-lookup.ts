import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { fetchWithTimeout } from '@/lib/fetch-with-timeout';
import {
  type TrackedCompletionAttribution,
  toTrackedCompletionAttribution,
} from '@/lib/tracked-order-completion';

// Shared verification budget: the reference-verification branch in
// verify-order-payment.ts uses the same ceiling.
export const VERIFY_TIMEOUT_MS = 15_000;

// Outcome of the read-only tracked-order lookup. Owned here (not imported
// from verify-order-payment.ts) so the dependency runs one way: the
// orchestrator imports this module, never the reverse.
export interface TrackedOrderVerification {
  paid: boolean;
  reconciliation?: 'order_cancelled' | 'order_skipped';
  terminalFailure?: 'failed' | 'cancelled' | 'abandoned';
  pending?: TrackedCompletionAttribution;
  /**
   * Transport/parse failure (not a verified unpaid row): callers that
   * must not treat absence-of-proof as proof-of-absence stay pending
   * on this instead of coercing to a definitive negative.
   */
  inconclusive?: boolean;
}

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

function toTrackedCustomer(value: unknown): TrackOrderData['customer'] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const customer = (value as { customer?: unknown }).customer;
  if (!customer || typeof customer !== 'object') {
    return null;
  }
  return customer as TrackOrderData['customer'];
}

function toTrackedItems(value: unknown): TrackOrderData['items'] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  const items = (value as { items?: unknown }).items;
  return Array.isArray(items) ? (items as TrackOrderData['items']) : [];
}

interface TrackedOrderRead {
  order: TrackOrderData['order'];
  customer: TrackOrderData['customer'] | null;
  items: TrackOrderData['items'];
}

async function readTrackedOrder(
  orderId: string,
  trackingToken: string
): Promise<TrackedOrderRead | null> {
  try {
    const response = await fetchWithTimeout(
      `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
      { timeout: VERIFY_TIMEOUT_MS }
    );
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    const order = toTrackedOrder(body);
    if (!order || order.id !== orderId) {
      return null;
    }
    return {
      order,
      customer: toTrackedCustomer(body),
      items: toTrackedItems(body),
    };
  } catch {
    return null;
  }
}

export async function checkTrackedOrderPaid(
  orderId: string,
  trackingToken: string
): Promise<TrackedOrderVerification> {
  const read = await readTrackedOrder(orderId, trackingToken);
  if (!read) {
    return { paid: false, inconclusive: true };
  }
  const attribution = toTrackedCompletionAttribution(
    read.order,
    read.customer,
    read.items
  );
  const trackedPaymentStatus = read.order.payment_status?.trim().toLowerCase();
  if (trackedPaymentStatus === 'refunded') {
    // A refund proves the provider captured the money (mirrors the
    // verify finalization kinds): no settlement poll can revive this
    // order, so surface reconciliation instead of the transient shape.
    return { paid: false, reconciliation: 'order_skipped' };
  }
  // Tolerate the US spelling: older rows (and some writers) store
  // 'canceled' while the rest of the flow compares 'cancelled'.
  if (
    trackedPaymentStatus === 'cancelled' ||
    trackedPaymentStatus === 'canceled'
  ) {
    // An ordinary cancelled row proves no capture (maintenance flips
    // stale unpaid orders to cancelled): unpaid terminal failure with
    // the error/retry path — never the "Payment Received"
    // reconciliation state. The orchestrator still consults a supplied
    // provider reference first, since late capture settles through the
    // verify endpoint after the row was written.
    return { paid: false, terminalFailure: 'cancelled' };
  }
  if (read.order.payment_status !== 'paid') {
    // Unpaid now, but the projection already carries the checkout identity
    // and breakdown the finalized path below would otherwise lose.
    return { paid: false, pending: attribution };
  }
  return { paid: true, ...attribution };
}
