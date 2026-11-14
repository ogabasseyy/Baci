'use client';

import { useEffect } from 'react';
import type { CartItem } from '@/hooks/cart';
import {
  getCartItemCheckoutUnitPrice,
  isQuizVoucherCartItem,
} from '@/lib/checkout/cart-entitlement-sanitizer';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';

type EventTrackingModule = typeof import('@/lib/event-tracking');

/** Module-scope dynamic import keeps the tracker out of the checkout chunk. */
function loadEventTracking(): Promise<EventTrackingModule> {
  return import('@/lib/event-tracking');
}

const reportedKeys = new Set<string>();

function hasUnresolvablePrice(item: CartItem): boolean {
  if (isQuizVoucherCartItem(item)) return false;
  const price = withNumericPrice(item).price;
  return typeof price !== 'number' || !Number.isFinite(price);
}

/**
 * Template grid lines can carry a formatted display string in `price` and
 * the amount in `rawPrice`; give the checkout price helper the number.
 */
function withNumericPrice(item: CartItem): CartItem {
  if (typeof item.price === 'number') return item;
  const rawPrice = (item as unknown as { rawPrice?: unknown }).rawPrice;
  return typeof rawPrice === 'number' && Number.isFinite(rawPrice)
    ? { ...item, price: rawPrice }
    : item;
}

/**
 * Claims a begin_checkout report once per browser session and checkout
 * attempt, matching the PostHog `checkout_started` dedupe, so refreshes and
 * re-renders do not inflate ad-platform checkout counts.
 */
function storageKeyFor(key: string): string {
  return `baci:begin_checkout:${key}`;
}

function isBeginCheckoutReported(key: string): boolean {
  if (reportedKeys.has(key)) return true;
  try {
    return window.sessionStorage.getItem(storageKeyFor(key)) !== null;
  } catch {
    return false;
  }
}

function claimBeginCheckoutReport(key: string): boolean {
  if (isBeginCheckoutReported(key)) return false;
  reportedKeys.add(key);
  try {
    window.sessionStorage.setItem(storageKeyFor(key), '1');
  } catch {
    // Storage can be blocked; the in-memory claim still dedupes this page.
  }
  return true;
}

interface UseBeginCheckoutTrackingParams {
  attemptId: string;
  checkoutCart: CartItem[];
  currency: string;
  isHydrated: boolean;
  merchantId?: string;
  loadTracker?: () => Promise<EventTrackingModule>;
}

/**
 * Reports begin_checkout to Baci (`/api/events`) and the ad pixels when a
 * shopper reaches the storefront checkout with a live cart. Resumed orders
 * (no live cart) are re-entries, not new checkout starts, and are skipped.
 */
export function useBeginCheckoutTracking({
  attemptId,
  checkoutCart,
  currency,
  isHydrated,
  merchantId,
  loadTracker = loadEventTracking,
}: UseBeginCheckoutTrackingParams): void {
  useEffect(() => {
    if (!isHydrated || !merchantId || checkoutCart.length === 0) return;
    // A line with no readable price (malformed, not a free voucher) would
    // report a misleading zero-value checkout; skip the event instead.
    if (checkoutCart.some(hasUnresolvablePrice)) return;
    // One report per checkout attempt and set of cart lines (matching the
    // PostHog checkout_started key): refreshes, re-renders, quantity edits
    // and same-cart return visits in this session are not new starts, while
    // a different set of lines is a new basket and reports again. The
    // in-memory set holds a few short keys per page and needs no eviction.
    // Logical line identity (product, variant, condition, offer), not cartItemId:
    // a shared-cart line swaps its temp: id for the server id on sync,
    // which is the same basket.
    const cartKey = checkoutCart
      .map(
        (item) =>
          `${item.id}:${item.variantId ?? ''}:${item.condition ?? ''}:${item.offerId ?? ''}`
      )
      .sort()
      .join('|');
    const reportKey = `${merchantId}:${attemptId}:${cartKey}`;
    // A newer cart supersedes this run: its pending send must not claim
    // the key with an outdated basket while the tracker chunk loads.
    let superseded = false;
    const cancelActivation = runWhenPageActivated(() => {
      if (isBeginCheckoutReported(reportKey)) return;
      void loadTracker()
        .then(({ trackEvent }) => {
          if (superseded) return;
          // Claim only once the tracker loaded, so a failed chunk load
          // leaves this attempt free to report on the next render.
          if (!claimBeginCheckoutReport(reportKey)) return;
          // Built at send time so a prerender-delayed report carries the
          // basket as presented, not as scheduled.
          const items = checkoutCart.map((item) => ({
            product: {
              id: String(item.id),
              name: item.name,
              // Same unit price checkout charges: unaccepted price proposals
              // stay at catalog and quiz vouchers are free.
              price: getCartItemCheckoutUnitPrice(withNumericPrice(item)),
              category: item.category,
              categories: item.categories,
            },
            quantity: item.quantity,
          }));
          trackEvent.beginCheckout(merchantId, items, currency);
        })
        .catch(() => {
          // Analytics must never break checkout.
        });
    });
    return () => {
      superseded = true;
      cancelActivation();
    };
  }, [attemptId, checkoutCart, currency, isHydrated, merchantId, loadTracker]);
}
