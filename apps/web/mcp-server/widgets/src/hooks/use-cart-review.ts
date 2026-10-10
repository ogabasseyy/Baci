import { openOgabasseyUrl } from '../open-ogabassey-url';
import {
  buildReviewCartUrl,
  hasReviewableHandoffLines,
} from '../review-cart-url';
import type { CartItem } from '../widget-types';

export interface CartReviewOptions {
  cart: CartItem[];
  cartUrl: string | undefined;
  /** Shared add/remove/view serialization flag. */
  busy: { current: boolean };
  setCartError: (message: string | null) => void;
}

/**
 * Review navigation for the guest cart: reachable while local lines exist
 * or the validated handoff URL still carries lines, so foreign-only
 * shared carts (nothing displayable locally) are inspectable instead of
 * stranded behind an empty cart with a review notice and no Review path.
 */
export function useCartReview(options: CartReviewOptions) {
  const { cart, cartUrl, busy, setCartError } = options;
  const canReviewCart =
    (cart.length > 0 && !!cartUrl) || hasReviewableHandoffLines(cartUrl);
  const handleViewCart = () => {
    if (busy.current || !canReviewCart) return;
    try {
      const reviewUrl = cartUrl ? buildReviewCartUrl(cartUrl) : null;
      if (reviewUrl) openOgabasseyUrl(reviewUrl);
    } catch {
      setCartError('Could not open your guest cart. Please try again.');
    }
  };
  return { canReviewCart, handleViewCart };
}
