'use client';

import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { useEffect } from 'react';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';
import {
  fetchStorefrontOrderData,
  type StorefrontOrderData,
} from './fetch-storefront-order';

// CredPal and Klump approve asynchronously: the launcher navigates here
// while the order is still pending, so the success path polls the
// token-scoped order until the provider webhook marks it paid. Two lanes:
// a fast lane for the first minute (webhooks usually land quickly), then
// a slow lane so approvals settling minutes later still update the page
// while the shopper waits. Bounded so a guest waiting on a slow approval
// is never stuck polling forever. Each lookup is abort-bounded so one
// hung request cannot stall the lane permanently.
const PENDING_BNPL_TYPES = ['credpal', 'klump'] as const;
type PendingBnplType = (typeof PENDING_BNPL_TYPES)[number];
const BNPL_SETTLEMENT_POLL_INTERVAL_MS = 3000;
const BNPL_SETTLEMENT_FAST_POLL_ATTEMPTS = 20;
const BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS = 15000;
const BNPL_SETTLEMENT_POLL_MAX_ATTEMPTS = 40;
const BNPL_SETTLEMENT_LOOKUP_TIMEOUT_MS = 10000;

function isPendingBnplType(value: string | null): value is PendingBnplType {
  return (
    value !== null && (PENDING_BNPL_TYPES as readonly string[]).includes(value)
  );
}

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

interface UseBnplSettlementInput {
  checkoutType: string | null;
  orderId: string | null;
  orderToken: string | null;
  merchantSlug: string | undefined;
  referenceParam: string | null;
  credpalRefParam: string | null;
  loading: boolean;
  order: StorefrontOrderData | null;
  setOrder: (order: StorefrontOrderData) => void;
}

/**
 * Owns the order-success BNPL settlement lifecycle: bounded two-lane
 * polling of the token-scoped order until the provider webhook marks it
 * paid, focus/visibility revalidation, and the deferred conversion
 * capture the launcher deliberately skipped.
 */
export function useBnplSettlement({
  checkoutType,
  orderId,
  orderToken,
  merchantSlug,
  referenceParam,
  credpalRefParam,
  loading,
  order,
  setOrder,
}: UseBnplSettlementInput) {
  const bnplType = isPendingBnplType(checkoutType) ? checkoutType : null;
  // The standard CredPal pending redirect carries the provider
  // transaction as `credpalRef` (see the checkout-page CredPal handler),
  // not `reference`: accept the alias so the later settlement capture
  // can reconcile the deferred conversion to the provider transaction.
  const bnplReference = referenceParam || credpalRefParam;

  // Pending BNPL approvals settle via webhook after navigation: keep
  // polling the token-scoped order until it reads paid, then capture the
  // conversion the launcher deliberately skipped. Revisits/refreshes are
  // safe: capture is once-guarded per order.
  const orderPaymentStatus = order?.payment_status;
  const needsSettlementPoll =
    bnplType !== null &&
    Boolean(orderId && orderToken) &&
    !loading &&
    orderPaymentStatus !== 'paid';
  useEffect(() => {
    if (!needsSettlementPoll || !orderId || !bnplType) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lookupTimeout: ReturnType<typeof setTimeout> | undefined;
    let lookupController: AbortController | null = null;
    const stop = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const abortLookup = () => {
      if (lookupTimeout !== undefined) {
        clearTimeout(lookupTimeout);
        lookupTimeout = undefined;
      }
      if (lookupController !== null) {
        lookupController.abort();
        lookupController = null;
      }
    };
    const scheduleNext = () => {
      const interval =
        attempts < BNPL_SETTLEMENT_FAST_POLL_ATTEMPTS
          ? BNPL_SETTLEMENT_POLL_INTERVAL_MS
          : BNPL_SETTLEMENT_SLOW_POLL_INTERVAL_MS;
      timer = setTimeout(() => {
        timer = undefined;
        void pollSettlement();
      }, interval);
    };
    // Serialized: the next poll is scheduled only after the current fetch
    // settles, so a slow older pending response can never arrive after a
    // newer paid response and overwrite the settled order (which would
    // also suppress the completion capture). Each lookup is abort-bounded
    // so a hung request releases the lane instead of stalling it forever.
    const pollSettlement = async () => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;
      attempts += 1;
      lookupController = new AbortController();
      lookupTimeout = setTimeout(() => {
        lookupController?.abort();
      }, BNPL_SETTLEMENT_LOOKUP_TIMEOUT_MS);
      let data: StorefrontOrderData | null = null;
      try {
        data = await fetchStorefrontOrderData(
          orderId,
          merchantSlug,
          orderToken,
          null,
          lookupController.signal
        );
      } finally {
        if (lookupTimeout !== undefined) {
          clearTimeout(lookupTimeout);
          lookupTimeout = undefined;
        }
        lookupController = null;
        inFlight = false;
      }
      if (cancelled) {
        return;
      }
      if (data) {
        setOrder(data);
      }
      if (
        data?.payment_status === 'paid' ||
        attempts >= BNPL_SETTLEMENT_POLL_MAX_ATTEMPTS
      ) {
        return;
      }
      scheduleNext();
    };
    // The shopper returned while a slow-lane wait was pending: revalidate
    // now instead of making them wait out the backoff.
    const revalidateOnVisible = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      if (cancelled || inFlight || timer === undefined) {
        return;
      }
      stop();
      void pollSettlement();
    };
    window.addEventListener('focus', revalidateOnVisible);
    document.addEventListener('visibilitychange', revalidateOnVisible);
    scheduleNext();
    return () => {
      cancelled = true;
      stop();
      abortLookup();
      window.removeEventListener('focus', revalidateOnVisible);
      document.removeEventListener('visibilitychange', revalidateOnVisible);
    };
  }, [
    needsSettlementPoll,
    orderId,
    orderToken,
    merchantSlug,
    bnplType,
    setOrder,
  ]);

  // Captures the pending-to-paid BNPL transition observed on this path
  // (including an already-paid first read the launcher's single check may
  // have raced). Immediate-paid launcher captures dedupe via the
  // once-guard, so this never double-counts within a session.
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
    const settledTotal = Number(order.total);
    // Stamped order currency: a merchant that changed payout currency
    // after the order must not relabel this deferred completion.
    const settledCurrency =
      typeof order.currency === 'string' && order.currency.trim()
        ? order.currency.trim().toUpperCase()
        : undefined;
    capturePendingBnplSettlement({
      orderId,
      orderNumber: order.order_number || order.short_id,
      paymentMethod: order.payment_method || bnplType,
      reference: bnplReference ?? undefined,
      ...(Number.isFinite(settledTotal) ? { total: settledTotal } : {}),
      ...(settledCurrency ? { currency: settledCurrency } : {}),
    });
  }, [bnplType, orderId, order, bnplReference]);
}
