import { useEffect, useRef } from 'react';
import type { TrackOrderData } from '@/components/track-order/TrackOrderScreen.types';
import {
  TRACK_ORDER_API_BASE_URL,
  TRACK_ORDER_MERCHANT_SLUG,
} from '@/components/track-order/track-order.config';
import { trackCheckoutPaymentCompletedOnce } from '@/services/analytics';

const JUICYWAY_SETTLEMENT_LOOKUP_TIMEOUT_MS = 15_000;

interface JuicywaySettlementCompletionParams {
  orderId?: string;
  orderNumber?: string;
  paymentMethod?: string;
  trackingToken?: string;
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

// Settlement-confirmed completion for mobile Juicyway orders. The checkout
// modal's "I've Sent the Payment" tap only routes to /order-success: the
// on-chain payment is detected asynchronously and the server marks the order
// paid later. Recording payment_completed here — gated on the
// server-confirmed paid state — closes the funnel without trusting the
// unverified button press.
export async function recordJuicywaySettlementCompletion({
  orderId,
  orderNumber,
  trackingToken,
}: {
  orderId: string;
  orderNumber?: string;
  trackingToken: string;
}): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    JUICYWAY_SETTLEMENT_LOOKUP_TIMEOUT_MS
  );
  try {
    const response = await fetch(
      `${TRACK_ORDER_API_BASE_URL}/api/storefront/orders/track-order?token=${encodeURIComponent(trackingToken)}&merchant_slug=${encodeURIComponent(TRACK_ORDER_MERCHANT_SLUG)}`,
      { signal: controller.signal }
    );
    if (!response.ok) {
      return false;
    }
    const order = toTrackedOrder(await response.json());
    // Attribute only the order this screen was opened for, and only once
    // the server confirms it paid. The durable claim inside
    // trackCheckoutPaymentCompletedOnce keeps remounts and repeated visits
    // to a single completion.
    if (!order || order.id !== orderId || order.payment_status !== 'paid') {
      return false;
    }
    const total = Number(order.total);
    return await trackCheckoutPaymentCompletedOnce({
      orderId,
      orderNumber: orderNumber || order.order_number || orderId,
      paymentMethod: 'juicyway',
      ...(Number.isFinite(total) ? { value: total } : {}),
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function useJuicywaySettlementCompletion({
  orderId,
  orderNumber,
  paymentMethod,
  trackingToken,
}: JuicywaySettlementCompletionParams): void {
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (
      paymentMethod !== 'juicyway' ||
      !orderId ||
      !trackingToken ||
      attemptedRef.current
    ) {
      return;
    }
    attemptedRef.current = true;
    void recordJuicywaySettlementCompletion({
      orderId,
      orderNumber,
      trackingToken,
    });
  }, [orderId, orderNumber, paymentMethod, trackingToken]);
}
