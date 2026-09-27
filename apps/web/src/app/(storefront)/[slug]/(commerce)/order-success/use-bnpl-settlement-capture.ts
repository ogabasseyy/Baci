'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { useEffect } from 'react';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import type { StorefrontOrderData } from './fetch-storefront-order';
import { BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS } from './use-bnpl-settlement';
import { verifyBnplSettlementProof } from './verify-bnpl-settlement-proof';

// Proof verification retries while a paid order stays unverified: the
// order lookup can observe paid before inventory confirmation converges,
// or the verify request can transiently fail. The order-polling lane has
// already stopped on the paid row, so without retries the conversion is
// never captured unless the shopper remounts. Bounded on the slow lane;
// capture is once-guarded, so a late success cannot double-count.
const BNPL_SETTLEMENT_VERIFY_MAX_ATTEMPTS = 12;

function capturePendingBnplSettlement({
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  total,
  currency,
}: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  total?: number;
  currency?: string;
}): void {
  // Inside a native BNPL WebView the native shell owns conversion
  // attribution (with native-verified outcomes): emitting here would
  // double-attribute every web completion event.
  if (
    typeof window !== 'undefined' &&
    (window as { ReactNativeWebView?: unknown }).ReactNativeWebView
  ) {
    return;
  }
  captureCheckoutFunnelEventOnce(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    orderId,
    buildCheckoutFunnelProperties({
      channel: 'web',
      currency,
      orderId,
      orderNumber,
      paymentIntent: 'installments',
      paymentMethod,
      paymentStatus: 'paid',
      reference,
      source: 'web_checkout',
      total,
    })
  );
}

/**
 * Captures the pending-to-paid BNPL transition observed on this path
 * (including an already-paid first read the launcher's single check may
 * have raced). Immediate-paid launcher captures dedupe via the
 * once-guard, so this never double-counts within a session.
 */
export function useBnplSettlementCapture({
  bnplType,
  orderId,
  order,
  bnplReference,
  orderToken,
}: {
  bnplType: string | null;
  orderId: string | null;
  order: StorefrontOrderData | null;
  bnplReference: string | null;
  orderToken: string | null;
}): void {
  useEffect(() => {
    // Identity-gate the capture: same-route navigation to another order
    // while the first lookup is in flight leaves the previous (possibly
    // paid) order in state, and claiming for the new orderId from the
    // stale order would both misattribute and — via the once-guard —
    // suppress the correct capture when the new lookup resolves.
    if (
      !bnplType ||
      !orderId ||
      !order ||
      order.id !== orderId ||
      order.payment_status !== 'paid'
    ) {
      return;
    }
    // No reference means nothing proof-bound to check: keep polling
    // instead of booking revenue on the paid row alone.
    if (!bnplReference || !orderToken) {
      return;
    }
    let cancelled = false;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    let verifyAttempts = 0;
    const verifyThenCapture = async () => {
      if (cancelled) {
        return;
      }
      verifyAttempts += 1;
      // Paid verdict implies inventory proof. A non-success verdict is
      // not a negative (unconverged inventory or transient failure), so
      // while the paid order stays unverified, retry on the slow lane
      // instead of exiting permanently and losing the conversion.
      const verified = await verifyBnplSettlementProof({
        orderId: order.id,
        orderToken,
        reference: bnplReference,
      });
      if (cancelled) {
        return;
      }
      if (!verified) {
        if (verifyAttempts < BNPL_SETTLEMENT_VERIFY_MAX_ATTEMPTS) {
          verifyTimer = setTimeout(() => {
            verifyTimer = undefined;
            void verifyThenCapture();
          }, BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS);
        }
        return;
      }
      const settledTotal = Number(order.total);
      // Stamped order currency: a merchant that changed payout
      // currency after the order must not relabel this deferred
      // completion.
      const settledCurrency =
        typeof order.currency === 'string' && order.currency.trim()
          ? order.currency.trim().toUpperCase()
          : undefined;
      capturePendingBnplSettlement({
        orderId,
        orderNumber: order.order_number || order.short_id,
        paymentMethod: order.payment_method || bnplType,
        reference: bnplReference,
        ...(Number.isFinite(settledTotal) ? { total: settledTotal } : {}),
        ...(settledCurrency ? { currency: settledCurrency } : {}),
      });
    };
    void verifyThenCapture();
    return () => {
      cancelled = true;
      if (verifyTimer !== undefined) {
        clearTimeout(verifyTimer);
        verifyTimer = undefined;
      }
    };
  }, [bnplType, orderId, order, bnplReference, orderToken]);
}
