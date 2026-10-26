import { parseConnectedCartReply, type ConnectedCartReply } from '../connected-cart-reply';
import { readStructuredContent } from '../parse-cart-tool-output';
import { widgetHost } from '../widget-host';
import { openOgabasseyUrl } from '../open-ogabassey-url';
import {
  buildReviewCartUrl,
  hasReviewableHandoffLines,
} from '../review-cart-url';
import type { CartItem } from '../widget-types';

export interface CartReviewOptions {
  cart: CartItem[];
  cartUrl: string | undefined;
  connectionCartId?: string;
  onConnectedRefresh?: (reply: ConnectedCartReply) => void;
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
    if (options.connectionCartId) {
      return (async () => {
      const host = widgetHost.get();
      if (!host?.callTool) { setCartError('Could not refresh your connected cart.'); return; }
      let pending: Window | null = null;
      busy.current = true;
      setCartError(null);
      try {
        pending = host.openExternal ? null : window.open('about:blank', '_blank');
        if (pending) pending.opener = null;
        const result = await host.callTool('get_ogabassey_guest_cart', {});
        const current = parseConnectedCartReply(readStructuredContent(result));
        if (!current || current.cartId !== options.connectionCartId) throw new Error('Cart unavailable');
        options.onConnectedRefresh?.(current);
        if (!current.items.length) { pending?.close(); setCartError('Your connected cart is empty.'); return; }
        if (!openOgabasseyUrl(current.url, pending)) throw new Error('Navigation blocked');
      } catch { pending?.close(); setCartError('Could not refresh your connected cart. Please retry.'); }
      finally { busy.current = false; }
      })();
    }
    try {
      const reviewUrl = cartUrl ? buildReviewCartUrl(cartUrl) : null;
      // A rejected URL (wrong path, foreign origin) must surface: the
      // button is enabled by the local lines, so silence would strand
      // the shopper behind a Review that neither navigates nor errors.
      // A blocked navigation (no bridge, popup blocked) surfaces too,
      // mirroring the add flow's popup remedy.
      if (reviewUrl) {
        if (!openOgabasseyUrl(reviewUrl))
          setCartError(
            'Could not open your guest cart. Please allow popups and try again.'
          );
      } else setCartError('This guest cart link is no longer valid.');
    } catch {
      setCartError('Could not open your guest cart. Please try again.');
    }
  };
  return { canReviewCart, handleViewCart };
}
