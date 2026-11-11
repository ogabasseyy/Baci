'use client';

import type { AnalyticsProduct } from '@/lib/analytics/analytics-product';
import { resolveTrackingCurrency } from '@/lib/analytics/resolve-tracking-currency';
import type { AddToCartOptions } from './cart-types';

type EventTrackingModule = typeof import('@/lib/event-tracking');

/**
 * Module-scope dynamic import: the tracker (and the ad-pixel helpers it pulls
 * in) stays out of the storefront shell bundle until the first real add.
 */
function loadEventTracking(): Promise<EventTrackingModule> {
  return import('@/lib/event-tracking');
}

export interface TrackCartAddInput {
  merchant:
    | {
        id?: string | null;
        country?: string | null;
        payout_currency?: string | null;
      }
    | null
    | undefined;
  /** Shell-provided merchant id, used when the merchant context is absent. */
  fallbackMerchantId: string | null | undefined;
  product: AnalyticsProduct;
  quantity: number;
  options?: AddToCartOptions;
  loadTracker?: () => Promise<EventTrackingModule>;
}

/**
 * Reports one applied storefront add to Baci (`/api/events`) and the ad
 * pixels. Called from the shared cart action so every template and entry
 * point (PDP, grids, quick view, chat, wishlist, upsells) counts exactly
 * once. Quiz prize voucher lines are free redemptions, not shopper adds.
 */
export function trackCartAdd({
  merchant,
  fallbackMerchantId,
  product,
  quantity,
  options,
  loadTracker = loadEventTracking,
}: TrackCartAddInput): void {
  if (options?.quizAwardId || options?.quizVoucherToken) return;
  const merchantId = merchant?.id || fallbackMerchantId;
  if (!merchantId) return;
  const currency = resolveTrackingCurrency(merchant);
  void loadTracker()
    .then(({ trackEvent }) => {
      trackEvent.addToCart(merchantId, product, quantity, currency);
    })
    .catch(() => {
      // Analytics must never break the cart.
    });
}
