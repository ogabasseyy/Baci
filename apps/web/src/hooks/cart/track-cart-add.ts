'use client';

import type { AnalyticsProduct } from '@/lib/analytics/analytics-product';
import { buildProductEvent } from '@/lib/analytics/build-product-event';
import { normalizeAnalyticsProduct } from '@/lib/analytics/normalize-analytics-product';
import { resolveTrackingCurrency } from '@/lib/analytics/resolve-tracking-currency';
import { sendTrackedEvent } from '@/lib/analytics/send-tracked-event';
import type { AddToCartOptions } from './cart-types';

type AnalyticsModule = typeof import('@/lib/analytics');

/**
 * Module-scope dynamic import: the ad-pixel helpers stay out of the
 * storefront shell bundle until the first real add. The first-party
 * `/api/events` send is imported eagerly (it is tiny) so it starts in the
 * click itself and its `keepalive` survives an immediate navigation.
 */
function loadAnalytics(): Promise<AnalyticsModule> {
  return import('@/lib/analytics');
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
  product: AnalyticsProduct;
  quantity: number;
  options?: AddToCartOptions;
  loadPixels?: () => Promise<AnalyticsModule>;
  send?: typeof sendTrackedEvent;
}

/** Mirrors the cart's own voucher test (delegated-add-preflight). */
function isQuizVoucherAdd(
  product: AnalyticsProduct,
  options: AddToCartOptions | undefined
): boolean {
  const record = product as unknown as Record<string, unknown>;
  return Boolean(
    options?.quizAwardId ||
      options?.quizVoucherToken ||
      record.quizAwardId ||
      record.quizVoucherToken ||
      record.isQuizPrize
  );
}

/**
 * Reports one applied storefront add to Baci (`/api/events`) and the ad
 * pixels with one shared event id. Called from the shared cart action so
 * every template and entry point (PDP, grids, quick view, chat, wishlist,
 * upsells) counts exactly once. Quiz prize vouchers are free redemptions,
 * not shopper adds, and are skipped.
 */
export function trackCartAdd(input: TrackCartAddInput): void {
  try {
    reportCartAdd(input);
  } catch {
    // Analytics must never break the cart add that called it.
  }
}

function reportCartAdd({
  merchant,
  product,
  quantity,
  options,
  loadPixels = loadAnalytics,
  send = sendTrackedEvent,
}: TrackCartAddInput): void {
  if (quantity <= 0) return;
  if (isQuizVoucherAdd(product, options)) return;
  // Require the full merchant (not a bare id) so the reported currency is
  // always the merchant's own; storefronts always provide it.
  const merchantId = merchant?.id;
  if (!merchantId) return;
  const tracked = normalizeAnalyticsProduct(product);
  if (!tracked) return;
  const currency = resolveTrackingCurrency(merchant);
  const eventId = crypto.randomUUID();

  void send(
    buildProductEvent({
      currency,
      eventId,
      eventType: 'add_to_cart',
      merchantId,
      product: tracked,
      quantity,
    })
  );
  void loadPixels()
    .then(({ analytics }) => {
      analytics.addToCart(tracked, quantity, currency, undefined, eventId);
    })
    .catch(() => {
      // Analytics must never break the cart.
    });
}
