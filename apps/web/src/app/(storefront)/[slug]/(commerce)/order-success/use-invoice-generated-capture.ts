'use client';

import { useEffect } from 'react';
import { captureCheckoutInvoiceGenerated } from '@/components/storefront/ogabassey/pages/checkout/capture-checkout-invoice-generated';
import {
  fetchStorefrontOrderData,
  type StorefrontOrderData,
} from './fetch-storefront-order';

// The immediate-order after() builds the invoice artifacts (persisted
// items, DVA, PDF, reminders) and emails the proforma AFTER the creation
// response, so the success page's first lookup usually predates terminal
// delivery. Claiming invoice_generated at creation would book a proforma
// conversion for generation that may still fail and that no later retry
// could repair; instead capture only once a lookup carries the server's
// terminal delivery flag. While an unpaid invoice order still awaits
// delivery, refetch on a short bounded lane. Stops on delivery,
// payment, or budget exhaustion — never polling forever.
// captureCheckoutFunnelEventOnce keeps refreshes (and replays repaired by
// a later visit) to a single capture.
const INVOICE_GENERATED_CAPTURE_INTERVAL_MS = 5000;
const INVOICE_GENERATED_CAPTURE_MAX_ATTEMPTS = 12;

function isUnpaidInvoiceOrder(order: StorefrontOrderData): boolean {
  return order.payment_method === 'invoice' && order.payment_status !== 'paid';
}

function captureFor(order: StorefrontOrderData): void {
  captureCheckoutInvoiceGenerated({
    currency: order.currency,
    itemCount: order.items.reduce(
      (count, item) => count + (item.quantity || 0),
      0
    ),
    orderId: order.id,
    orderNumber: order.order_number,
    total: order.total,
  });
}

export function useInvoiceGeneratedCapture({
  lookupEmail,
  merchantSlug,
  onOrder,
  order,
  orderId,
  orderToken,
}: {
  lookupEmail: string | null;
  merchantSlug: string | undefined;
  onOrder: (order: StorefrontOrderData) => void;
  order: StorefrontOrderData | null;
  orderId: string | null;
  orderToken: string | null;
}): void {
  useEffect(() => {
    if (!orderId || !order || !isUnpaidInvoiceOrder(order)) {
      return;
    }
    // A later visit (or replay repaired since) can arrive already
    // delivered: capture without spending the refresh budget.
    if (order.notification_delivered) {
      captureFor(order);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const data = await fetchStorefrontOrderData(
        orderId,
        merchantSlug,
        orderToken,
        lookupEmail
      ).catch(() => null);
      if (cancelled) {
        return;
      }
      if (data) {
        onOrder(data);
        // Terminal delivery observed: the artifacts exist, so the
        // proforma conversion is real — capture and stop.
        if (isUnpaidInvoiceOrder(data) && data.notification_delivered) {
          captureFor(data);
          return;
        }
        // Paid orders need no proforma event; stop instead of burning
        // the lane waiting for a flag that no longer matters.
        if (data.payment_status === 'paid') {
          return;
        }
      }
      if (attempts < INVOICE_GENERATED_CAPTURE_MAX_ATTEMPTS) {
        timer = setTimeout(
          () => void poll(),
          INVOICE_GENERATED_CAPTURE_INTERVAL_MS
        );
      }
    };
    timer = setTimeout(
      () => void poll(),
      INVOICE_GENERATED_CAPTURE_INTERVAL_MS
    );
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [lookupEmail, merchantSlug, onOrder, order, orderId, orderToken]);
}
