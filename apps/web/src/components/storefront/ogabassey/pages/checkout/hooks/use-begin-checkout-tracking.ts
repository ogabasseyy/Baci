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
function claimBeginCheckoutReport(key: string): boolean {
  if (reportedKeys.has(key)) return false;
  reportedKeys.add(key);
  try {
    const storageKey = `baci:begin_checkout:${key}`;
    if (window.sessionStorage.getItem(storageKey)) return false;
    window.sessionStorage.setItem(storageKey, '1');
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
    const cartKey = checkoutCart
      .map((item) => `${item.cartItemId || item.id}:${item.quantity}`)
      .join('|');
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
      if (!claimBeginCheckoutReport(`${merchantId}:${attemptId}:${cartKey}`)) {
        return;
      }
      void loadTracker()
        .then(({ trackEvent }) => {
          trackEvent.beginCheckout(merchantId, items, currency);
        })
        .catch(() => {
          // Analytics must never break checkout.
        });
    });
  }, [attemptId, checkoutCart, currency, isHydrated, merchantId, loadTracker]);
}
