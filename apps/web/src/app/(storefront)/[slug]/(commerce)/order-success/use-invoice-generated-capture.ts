'use client';

import { useEffect, useRef } from 'react';
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

// Row-level proforma evidence for refreshed lookups, mirroring
// resolveInvoicePresentation: the server emails credited (wallet/savings
// amount_paid), refunded, and partially-paid invoices as commercial
// documents, so their delivery must not book a proforma conversion even
// when the lane started from a proforma-looking first read.
function isProformaRow(order: StorefrontOrderData): boolean {
  const credited = Number(order.amount_paid ?? 0);
  return (
    isUnpaidInvoiceOrder(order) &&
    order.payment_status !== 'refunded' &&
    order.payment_status !== 'partially_paid' &&
    !(Number.isFinite(credited) && credited > 0)
  );
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
  isProforma,
  lookupEmail,
  merchantSlug,
  onOrder,
  order,
  orderId,
  orderToken,
}: {
  /**
   * Genuine-proforma predicate from resolveInvoicePresentation: invoice
   * orders partially covered by wallet/savings credit are emailed as
   * commercial documents, so capturing invoice_generated for them would
   * contaminate the payment_intent=proforma_invoice funnel. False (or a
   * null order pre-load) runs no lane and captures nothing.
   */
  isProforma: boolean;
  lookupEmail: string | null;
  merchantSlug: string | undefined;
  onOrder: (order: StorefrontOrderData) => void;
  order: StorefrontOrderData | null;
  orderId: string | null;
  orderToken: string | null;
}): void {
  // Attempt budget retained across effect restarts: onOrder refreshes
  // replace the order object (new identity), which must not reset the
  // 12-attempt bound — otherwise the lane never expires. Keyed by
  // order so a new order starts a fresh budget.
  const attemptsRef = useRef(0);
  const budgetOrderRef = useRef<string | null>(null);
  if (budgetOrderRef.current !== orderId) {
    budgetOrderRef.current = orderId;
    attemptsRef.current = 0;
  }
  useEffect(() => {
    if (!orderId || !order || !isUnpaidInvoiceOrder(order)) {
      return;
    }
    // Commercial (credited/refunded/partially-paid) invoice orders share
    // the unpaid lane shape but belong to no proforma funnel: stop
    // without capturing, polling, or spending the refresh budget.
    if (!isProforma) {
      return;
    }
    // A later visit (or replay repaired since) can arrive already
    // delivered: capture without spending the refresh budget.
    if (order.notification_delivered) {
      captureFor(order);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      attemptsRef.current += 1;
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
        // proforma conversion is real — capture and stop. Re-check the
        // row evidence: credit can first appear on a refresh.
        if (isProformaRow(data) && data.notification_delivered) {
          captureFor(data);
          return;
        }
        // Paid orders need no proforma event; stop instead of burning
        // the lane waiting for a flag that no longer matters.
        if (data.payment_status === 'paid') {
          return;
        }
      }
      if (attemptsRef.current < INVOICE_GENERATED_CAPTURE_MAX_ATTEMPTS) {
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
    // Depend on order primitives (not the order object identity):
    // refreshes replace the object while the primitives are unchanged,
    // and an identity dep would restart the lane pointlessly. The
    // budget ref still bounds total attempts across restarts.
  }, [
    isProforma,
    lookupEmail,
    merchantSlug,
    onOrder,
    order?.notification_delivered,
    order?.payment_method,
    order?.payment_status,
    orderId,
    orderToken,
  ]);
}
