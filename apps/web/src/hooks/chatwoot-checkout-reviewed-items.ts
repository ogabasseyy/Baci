import type { CartItem } from '@/hooks/cart';
import {
  reviewedCheckoutItems,
  type SharedCartCheckoutReview,
} from '@/hooks/cart/shared-cart-checkout-client';
import { calculateCartItemSubtotal } from '@/lib/checkout/cart-entitlement-sanitizer';

/**
 * Returns the reviewed order items, or null when the reviewed lines no longer
 * match the display cart (unavailable line, moved price, missing shell). The
 * store checkout applies the same gates before it submits.
 */
export function reviewedChatwootCheckoutItems(
  review: SharedCartCheckoutReview,
  display: readonly CartItem[]
): CartItem[] | null {
  if (
    review.currency !== 'NGN' ||
    review.unavailableCount > 0 ||
    review.lines.some((line) => !line.available)
  ) {
    return null;
  }
  const items = reviewedCheckoutItems(display, review);
  if (
    !items ||
    Math.abs(
      review.subtotalMinor / 100 - calculateCartItemSubtotal(items, true)
    ) > 0.005
  ) {
    return null;
  }
  return items;
}
