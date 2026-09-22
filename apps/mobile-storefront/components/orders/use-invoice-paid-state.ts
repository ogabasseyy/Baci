import { useEffect, useState } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { isDeferredSettlementMethod } from './order-success-content';

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

// Payment outcome for a guest deferred-settlement order (invoice, Pay for
// Me): refunded is distinct from unpaid — the order was previously paid,
// so it must never render proforma/request copy.
export type GuestInvoicePaymentStatus = 'paid' | 'refunded' | 'unpaid';

export interface GuestInvoicePaymentState {
  status: GuestInvoicePaymentStatus;
  /**
   * Whether the status is authoritative yet: true synchronously when no
   * lookup is needed (skipped, non-deferred, or missing identity), and
   * only after the token lookup settles otherwise. Screens gate
   * purchase-success side effects (notification, interstitial, soft ask)
   * on this so a slow lookup cannot trigger them for an order that is
   * about to flip to reconciliation.
   */
  isResolved: boolean;
}

// Resolves the paid state for guest deferred-settlement orders (invoice,
// Pay for Me). The authenticated receipt-detail query is disabled without
// a signed-in user, so a guest returning through the tracking token would
// otherwise always see proforma/request copy even after external payment.
// A single token-scoped lookup is enough: it serves the returning
// (already settled) shopper, not live polling.
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
}): GuestInvoicePaymentState {
  // Whether this identity needs the token lookup at all. Derived during
  // render (not state) so screens see `isResolved: true` synchronously
  // when there is nothing to wait for — side effects for ordinary
  // synchronous checkouts must not stall a frame on the async lookup.
  const lookupNeeded =
    !skip &&
    isDeferredSettlementMethod(paymentMethod) &&
    !!orderId &&
    !!trackingToken;
  const [status, setStatus] = useState<GuestInvoicePaymentStatus>('unpaid');
  const [lookupSettled, setLookupSettled] = useState(false);
  useEffect(() => {
    // The payment state belongs to one lookup identity: same-route
    // navigation or a new deep link can swap a paid guest invoice for a
    // different unpaid one on the mounted route, and the new lookup must
    // not inherit the previous order's paid presentation
    // (receipt/commercial copy for an unpaid order).
    setStatus('unpaid');
    setLookupSettled(false);
    if (!lookupNeeded) {
      return;
    }
    let cancelled = false;
    let activeController: AbortController | null = null;
    void (async () => {
      // A failed lookup (timeout, 5xx, transport) answers nothing about
      // the order: retry once before accepting unpaid presentation, so a
      // transient blip cannot strand a paid guest invoice on proforma
      // copy. An ok response is authoritative either way and never
      // retries.
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const controller = new AbortController();
        activeController = controller;
        const timeout = setTimeout(
          () => controller.abort(),
          GUEST_INVOICE_LOOKUP_TIMEOUT_MS
        );
        try {
          const response = await fetch(
            `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
            { signal: controller.signal }
          );
          if (cancelled) {
            return;
          }
          if (!response.ok) {
            continue;
          }
          const order = toTrackedOrder(await response.json());
          if (cancelled) {
            return;
          }
          if (order && order.id === orderId) {
            if (order.payment_status === 'paid') {
              setStatus('paid');
            } else if (order.payment_status === 'refunded') {
              // Previously paid, now refunded: distinct from unpaid so the
              // screen renders reconciliation/commercial state instead of
              // proforma/request copy.
              setStatus('refunded');
            }
          }
          setLookupSettled(true);
          return;
        } catch {
          // Transport failures stay unresolved: an exhausted lookup
          // answers nothing, so the status must not become authoritative
          // — a refunded order would otherwise present guessed-unpaid
          // copy with success side effects enabled. Display stays
          // proforma; the shopper can still pay or retry.
          if (cancelled || attempt >= 2) {
            return;
          }
        } finally {
          clearTimeout(timeout);
          if (activeController === controller) {
            activeController = null;
          }
        }
      }
      // Repeated non-ok responses (5xx) likewise answer nothing: stay
      // unresolved rather than blessing the guessed-unpaid default.
    })();
    return () => {
      cancelled = true;
      activeController?.abort();
    };
  }, [lookupNeeded, orderId, trackingToken]);
  return { status, isResolved: !lookupNeeded || lookupSettled };
}
