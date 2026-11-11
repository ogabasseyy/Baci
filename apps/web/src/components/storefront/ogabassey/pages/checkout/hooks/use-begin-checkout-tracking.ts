'use client';

import { useEffect } from 'react';
import type { CartItem } from '@/hooks/cart';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';

type EventTrackingModule = typeof import('@/lib/event-tracking');

/** Module-scope dynamic import keeps the tracker out of the checkout chunk. */
function loadEventTracking(): Promise<EventTrackingModule> {
  return import('@/lib/event-tracking');
}

const reportedKeys = new Set<string>();

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
    // Key on which lines are in the cart, not their quantities: editing a
    // quantity on the checkout page is not a new checkout start.
    const cartKey = checkoutCart
      .map((item) => item.cartItemId || item.id)
      .sort()
      .join('|');
    const reportKey = `${merchantId}:${attemptId}:${cartKey}`;
    const items = checkoutCart.map((item) => ({
      product: {
        id: item.id,
        name: item.name,
        price: item.negotiatedPrice ?? item.price,
        category: item.category,
        categories: item.categories,
      },
      quantity: item.quantity,
    }));
    return runWhenPageActivated(() => {
      if (isBeginCheckoutReported(reportKey)) return;
      void loadTracker()
        .then(({ trackEvent }) => {
          // Claim only once the tracker loaded, so a failed chunk load
          // leaves this attempt free to report on the next render.
          if (!claimBeginCheckoutReport(reportKey)) return;
          trackEvent.beginCheckout(merchantId, items, currency);
        })
        .catch(() => {
          // Analytics must never break checkout.
        });
    });
  }, [attemptId, checkoutCart, currency, isHydrated, merchantId, loadTracker]);
}
