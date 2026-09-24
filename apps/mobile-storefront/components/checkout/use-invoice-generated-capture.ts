import { useEffect } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { maybeCaptureCheckoutInvoiceGenerated } from './checkout-invoice-claim';

// The immediate-order after() builds the invoice artifacts (persisted
// items, DVA, PDF, reminders) and emails the proforma AFTER the creation
// response, so the success screen's first lookup usually predates terminal
// delivery. Capturing invoice_generated at creation would book a proforma
// conversion for generation that may still fail and that no later retry
// could repair; instead capture only once a lookup carries the server's
// terminal delivery flag, on a short bounded lane. Stops on delivery,
// payment, or budget exhaustion — never polling forever. The durable
// purchase claim keeps revisits and repaired replays to a single capture.
const INVOICE_CAPTURE_POLL_INTERVAL_MS = 5000;
const INVOICE_CAPTURE_MAX_ATTEMPTS = 12;
const INVOICE_CAPTURE_LOOKUP_TIMEOUT_MS = 15_000;

interface InvoiceGeneratedCaptureParams {
  /**
   * Signed-in shopper email for the proof-bound order lookup. Used only
   * when no tracking token is available (the token lookup serves guests
   * and token-carrying sessions).
   */
  customerEmail?: string | null;
  /**
   * Terminal non-proforma states (captured-but-cancelled/refunded): the
   * order can never need a proforma event, so skip the lookup budget.
   */
  disabled?: boolean;
  orderId?: string;
  paymentMethod?: string;
  trackingToken?: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
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

interface StorefrontOrderPayload {
  id?: unknown;
  order_number?: unknown;
  payment_method?: unknown;
  payment_status?: unknown;
  total?: unknown;
  currency?: unknown;
  notification_delivered?: unknown;
  amount_paid?: unknown;
  shipping_status?: unknown;
  items?: unknown;
}

function toStorefrontOrder(value: unknown): StorefrontOrderPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as StorefrontOrderPayload;
}

function toQuantityList(items: unknown): Array<{ quantity: number }> {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => ({
    quantity:
      item && typeof item === 'object'
        ? Number((item as { quantity?: unknown }).quantity) || 0
        : 0,
  }));
}

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal
): Promise<unknown | null> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as unknown;
}

export function useInvoiceGeneratedCapture({
  customerEmail,
  disabled = false,
  orderId,
  paymentMethod,
  trackingToken,
  pollIntervalMs = INVOICE_CAPTURE_POLL_INTERVAL_MS,
  maxAttempts = INVOICE_CAPTURE_MAX_ATTEMPTS,
}: InvoiceGeneratedCaptureParams): void {
  useEffect(() => {
    if (
      disabled ||
      paymentMethod !== 'invoice' ||
      !orderId ||
      (!trackingToken && !customerEmail)
    ) {
      return;
    }
    let cancelled = false;
    const attemptControllers: AbortController[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const captureFromTracked = async (
      order: TrackOrderData['order'],
      items: unknown
    ): Promise<boolean> => {
      if (order.id !== orderId || order.payment_status === 'paid') {
        return order.payment_status === 'paid';
      }
      // Same gate as the storefront branch: the tracked method must
      // prove this row is an invoice order (a guest can open a
      // delivered Pay-for-Me/POD order with a caller-controlled
      // paymentMethod=invoice), and the raw shipping status feeds the
      // proforma predicate so shipping-cancelled rows classify like
      // the storefront path instead of misbooking.
      if (
        order.payment_method === 'invoice' &&
        order.payment_status !== 'paid' &&
        order.notification_delivered === true &&
        typeof order.total === 'number'
      ) {
        await maybeCaptureCheckoutInvoiceGenerated({
          selectedPayment: 'invoice',
          order: {
            id: order.id,
            payment_status: order.payment_status,
            total: order.total,
            currency: order.currency ?? undefined,
            notificationDelivered: true,
            // Prior-payment + shipping evidence for the proforma
            // predicate (credited/shipping-cancelled are commercial).
            amountPaid: order.amount_paid ?? undefined,
            shippingStatus: order.shipping_status ?? undefined,
          },
          orderNumber: order.order_number,
          itemsSnapshot: toQuantityList(items),
        });
        return true;
      }
      return false;
    };

    const captureFromStorefront = async (
      order: StorefrontOrderPayload
    ): Promise<boolean> => {
      if (order.id !== orderId) {
        return false;
      }
      if (order.payment_status === 'paid') {
        return true;
      }
      if (
        order.payment_method === 'invoice' &&
        order.payment_status !== 'paid' &&
        order.notification_delivered === true &&
        typeof order.total === 'number'
      ) {
        await maybeCaptureCheckoutInvoiceGenerated({
          selectedPayment: 'invoice',
          order: {
            id: orderId,
            payment_status:
              typeof order.payment_status === 'string'
                ? order.payment_status
                : undefined,
            total: order.total,
            currency:
              typeof order.currency === 'string' ? order.currency : undefined,
            notificationDelivered: true,
            // Prior-payment + shipping evidence for the proforma
            // predicate (credited/shipping-cancelled are commercial).
            amountPaid:
              typeof order.amount_paid === 'number'
                ? order.amount_paid
                : undefined,
            shippingStatus:
              typeof order.shipping_status === 'string'
                ? order.shipping_status
                : undefined,
          },
          orderNumber:
            typeof order.order_number === 'string'
              ? order.order_number
              : orderId,
          itemsSnapshot: toQuantityList(order.items),
        });
        return true;
      }
      return false;
    };

    const check = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const controller = new AbortController();
      attemptControllers.push(controller);
      const lookupTimeout = setTimeout(
        () => controller.abort(),
        INVOICE_CAPTURE_LOOKUP_TIMEOUT_MS
      );
      try {
        let done = false;
        if (trackingToken) {
          const body = await fetchWithTimeout(
            `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
            controller.signal
          );
          const order = body ? toTrackedOrder(body) : null;
          const items =
            body && typeof body === 'object'
              ? (body as { items?: unknown }).items
              : null;
          done = order ? await captureFromTracked(order, items) : false;
        } else if (customerEmail) {
          const query = new URLSearchParams({
            merchant_slug: TRACK_ORDER_MERCHANT_SLUG,
            email: customerEmail,
          });
          const body = await fetchWithTimeout(
            `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/${encodeURIComponent(orderId)}?${query.toString()}`,
            controller.signal
          );
          const order = body ? toStorefrontOrder(body) : null;
          done = order ? await captureFromStorefront(order) : false;
        }
        if (cancelled || done) {
          return;
        }
      } catch {
        // Transient lookup failure: retry until the attempt budget runs
        // out. An unconfirmed delivery simply records nothing — a later
        // confirmed visit repairs the event through the durable claim.
      } finally {
        clearTimeout(lookupTimeout);
      }
      if (cancelled) {
        return;
      }
      if (attempts < maxAttempts) {
        retryTimer = setTimeout(() => {
          void check();
        }, pollIntervalMs);
      }
    };

    void check();
    return () => {
      cancelled = true;
      for (const controller of attemptControllers) {
        controller.abort();
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    customerEmail,
    disabled,
    maxAttempts,
    orderId,
    paymentMethod,
    pollIntervalMs,
    trackingToken,
  ]);
}
