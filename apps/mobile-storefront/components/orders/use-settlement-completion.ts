import { useEffect } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
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
]);

const SETTLEMENT_LOOKUP_TIMEOUT_MS = 15_000;
const SETTLEMENT_POLL_INTERVAL_MS = 10_000;
const SETTLEMENT_MAX_ATTEMPTS = 18;

interface SettlementCompletionParams {
  orderId?: string;
  orderNumber?: string;
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

async function fetchSettlementState(
  trackingToken: string,
  signal: AbortSignal
): Promise<{
  order: TrackOrderData['order'] | null;
  customer: TrackOrderData['customer'] | null;
}> {
  const response = await fetch(
    `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
    { signal }
  );
  if (!response.ok) {
    return { order: null, customer: null };
  }
  const body: unknown = await response.json();
  return { order: toTrackedOrder(body), customer: toTrackedCustomer(body) };
}

function finiteOrUndefined(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

// Settlement-confirmed completion for asynchronous mobile payments. Only a
// server-confirmed paid state for this exact order records
// payment_completed; the durable once-helper keeps remounts, polling
// retries, and repeated visits to a single completion.
export function useSettlementCompletion({
  orderId,
  orderNumber,
  paymentMethod,
  trackingToken,
  pollIntervalMs = SETTLEMENT_POLL_INTERVAL_MS,
  maxAttempts = SETTLEMENT_MAX_ATTEMPTS,
}: SettlementCompletionParams): void {
  useEffect(() => {
    if (
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
        const { order, customer } = await fetchSettlementState(
          trackingToken,
          controller.signal
        );
        if (cancelled) {
          return;
        }
        if (order && order.id === orderId && order.payment_status === 'paid') {
          const total = finiteOrUndefined(order.total);
          const subtotal = finiteOrUndefined(order.subtotal);
          const shipping = finiteOrUndefined(order.shipping_cost);
          await trackCheckoutPaymentCompletedOnce({
            customerEmail: customer?.email || undefined,
            customerPhone: customer?.phone || undefined,
            orderId,
            orderNumber: orderNumber || order.order_number || orderId,
            paymentMethod,
            ...(shipping !== undefined ? { shipping } : {}),
            ...(subtotal !== undefined ? { subtotal } : {}),
            ...(total !== undefined ? { value: total } : {}),
          });
          return;
        }
      } catch {
        // Transient lookup failure: retry until the attempt budget runs out.
      } finally {
        clearTimeout(lookupTimeout);
      }
      if (!cancelled && attempts < maxAttempts) {
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
    maxAttempts,
    orderId,
    orderNumber,
    paymentMethod,
    pollIntervalMs,
    trackingToken,
  ]);
}
