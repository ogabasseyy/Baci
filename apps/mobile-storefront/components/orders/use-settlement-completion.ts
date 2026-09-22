import { useEffect } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { toTrackedCompletionAttribution } from '@/lib/tracked-order-completion';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';

// Asynchronous settlement methods: the shopper can reach success before the
// provider/webhook confirms payment (on-chain detection for Juicyway, DVA
// credit for bank transfers, late gateway webhooks for card payments), so
// the success screen polls the server-confirmed order state instead of
// trusting the arrival. Synchronous methods (wallet, store_credit, voucher)
// complete inline and never poll.
const SETTLEMENT_POLL_METHODS = new Set([
  'juicyway',
  'bank_transfer',
  'paystack',
  'korapay',
  // Accepted-but-pending CredPal applications skip inline completion and
  // settle asynchronously after approval.
  'credpal',
  // Klump returns carry no settlement proof, so every Klump checkout
  // defers completion to the tracked order.
  'klump',
]);

const SETTLEMENT_LOOKUP_TIMEOUT_MS = 15_000;
const SETTLEMENT_POLL_INTERVAL_MS = 10_000;
const SETTLEMENT_MAX_ATTEMPTS = 18;
// Juicyway confirms on-chain with an advertised 5–30 minute window
// (see the crypto payment fixtures), so its budget spans ~30 minutes at
// the standard interval instead of stopping after ~3. Other methods keep
// the short budget: their webhooks settle in seconds.
const JUICYWAY_SETTLEMENT_MAX_ATTEMPTS = 180;
// Slow lane after the fast budget runs out: bank transfers and
// CredPal/Klump approvals can legitimately settle later than ~3 minutes,
// so a shopper who stays on the screen keeps a minute-cadence watch for
// another ~27 minutes instead of missing payment_completed entirely.
const SETTLEMENT_SLOW_POLL_INTERVAL_MS = 60_000;
const SETTLEMENT_SLOW_MAX_ATTEMPTS = 27;

interface SettlementCompletionParams {
  orderId?: string;
  orderNumber?: string;
  paymentMethod?: string;
  reference?: string;
  trackingToken?: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  slowPollIntervalMs?: number;
  slowMaxAttempts?: number;
  /**
   * Terminal non-paid states (captured-but-cancelled/refunded): polling
   * can never make the order paid, so skip the lookup budget entirely.
   */
  disabled?: boolean;
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

async function fetchSettlementState(
  trackingToken: string,
  signal: AbortSignal
): Promise<{
  body: unknown;
  order: TrackOrderData['order'] | null;
  customer: TrackOrderData['customer'] | null;
}> {
  const response = await fetch(
    `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
    { signal }
  );
  if (!response.ok) {
    return { body: null, order: null, customer: null };
  }
  const body: unknown = await response.json();
  return {
    body,
    order: toTrackedOrder(body),
    customer: toTrackedCustomer(body),
  };
}

// Settlement-confirmed completion for asynchronous mobile payments. Only a
// server-confirmed paid state for this exact order records
// payment_completed; the durable once-helper keeps remounts, polling
// retries, and repeated visits to a single completion.
export function useSettlementCompletion({
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  trackingToken,
  pollIntervalMs = SETTLEMENT_POLL_INTERVAL_MS,
  maxAttempts = paymentMethod === 'juicyway'
    ? JUICYWAY_SETTLEMENT_MAX_ATTEMPTS
    : SETTLEMENT_MAX_ATTEMPTS,
  slowPollIntervalMs = SETTLEMENT_SLOW_POLL_INTERVAL_MS,
  slowMaxAttempts = SETTLEMENT_SLOW_MAX_ATTEMPTS,
  disabled = false,
}: SettlementCompletionParams): void {
  useEffect(() => {
    if (
      disabled ||
      !paymentMethod ||
      !SETTLEMENT_POLL_METHODS.has(paymentMethod) ||
      !orderId ||
      !trackingToken
    ) {
      return;
    }
    let cancelled = false;
    const attemptControllers: AbortController[] = [];
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let slowAttempts = 0;

    const check = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const controller = new AbortController();
      attemptControllers.push(controller);
      const lookupTimeout = setTimeout(
        () => controller.abort(),
        SETTLEMENT_LOOKUP_TIMEOUT_MS
      );
      try {
        const { body, order, customer } = await fetchSettlementState(
          trackingToken,
          controller.signal
        );
        if (cancelled) {
          return;
        }
        if (order && order.id === orderId && order.payment_status === 'paid') {
          const { total: verifiedTotal, ...attribution } =
            toTrackedCompletionAttribution(
              order,
              customer,
              toTrackedItems(body)
            );
          const outcome = await trackCheckoutPaymentCompletedOnce({
            ...attribution,
            orderId,
            orderNumber: orderNumber || order.order_number || orderId,
            paymentMethod,
            // This polling path wins the durable completion claim, so it
            // must forward the route's provider reference: without it the
            // deferred conversion cannot be reconciled to its transaction
            // and the spent claim blocks any later richer capture.
            ...(reference ? { reference } : {}),
            value: verifiedTotal,
          });
          if (outcome !== 'released') {
            return;
          }
          // The claim was released after a failed emission (or never
          // granted): the order is still paid but nothing was recorded, so
          // fall through and reschedule the next poll instead of returning
          // as though completion had been recorded.
        }
      } catch {
        // Transient lookup failure: retry until the attempt budget runs out.
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
      } else if (slowAttempts < slowMaxAttempts) {
        // Fast budget spent without settlement: drop to the slow lane
        // rather than abandoning a shopper whose transfer or BNPL
        // approval lands minutes later.
        slowAttempts += 1;
        retryTimer = setTimeout(() => {
          void check();
        }, slowPollIntervalMs);
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
    disabled,
    maxAttempts,
    orderId,
    orderNumber,
    paymentMethod,
    pollIntervalMs,
    reference,
    slowMaxAttempts,
    slowPollIntervalMs,
    trackingToken,
  ]);
}
