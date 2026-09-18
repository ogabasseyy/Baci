import { useEffect } from 'react';
import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { captureCheckoutFunnelEventOnce } from '@/lib/posthog/capture-checkout-funnel-event';

export interface CheckoutStartFunnelItem {
  kind: 'cart' | 'resumed';
  id: string | number;
  quantity: number;
}

interface UseCheckoutStartFunnelParams {
  displayItems: CheckoutStartFunnelItem[];
  effectiveCheckoutCartTotal: number;
  effectiveItemSubtotal: number;
  attemptId?: string;
  currency?: string;
  isHydrated: boolean;
  merchantId?: string;
}

export function useCheckoutStartFunnel({
  displayItems,
  effectiveCheckoutCartTotal,
  effectiveItemSubtotal,
  attemptId,
  currency,
  isHydrated,
  merchantId,
}: UseCheckoutStartFunnelParams): void {
  useEffect(() => {
    if (!isHydrated || displayItems.length === 0) return;
    const cartKey = displayItems
      .map((item) => `${item.kind}:${item.id}:${item.quantity}`)
      .join('|');
    // Scope the session dedupe to a single checkout attempt so a repeat
    // purchase of the same cart in one session emits a fresh start event.
    const dedupeKey = attemptId
      ? `cart:${merchantId || 'store'}:${attemptId}:${cartKey}`
      : `cart:${merchantId || 'store'}:${cartKey}`;
    captureCheckoutFunnelEventOnce(
      CHECKOUT_FUNNEL_EVENTS.checkoutStarted,
      dedupeKey,
      buildCheckoutFunnelProperties({
        channel: 'web',
        currency: currency || 'NGN',
        itemCount: displayItems.reduce((count, item) => count + item.quantity, 0),
        source: 'web_checkout',
        subtotal: effectiveItemSubtotal,
        total: effectiveCheckoutCartTotal,
      })
    );
  }, [
    displayItems,
    effectiveCheckoutCartTotal,
    effectiveItemSubtotal,
    attemptId,
    currency,
    isHydrated,
    merchantId,
  ]);
}
