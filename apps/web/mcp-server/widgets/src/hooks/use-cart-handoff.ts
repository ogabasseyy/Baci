import { refreshConnectedCart } from '../refresh-connected-cart';
import { parseConnectedCartReply, mergeConnectedCartReply } from '../connected-cart-reply';
import { useRef, useState } from 'react';
import {
  dropLineFromCartState,
  reconcileCartLineQuantities,
} from '../drop-cart-line';
import {
  parseCartToolOutput,
  readStructuredContent,
} from '../parse-cart-tool-output';
import { parseRemovalRemaining } from '../parse-removal-remaining';
import { widgetHost } from '../widget-host';
import type { WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { createCartAddHandler } from './use-cart-add';
import { useCartReview } from './use-cart-review';
import { useCartSyncNotice } from './use-cart-sync-notice';
import { useWidgetState } from './use-widget-state';

export function useCartHandoff() {
  const [widgetState, setWidgetState] =
    useWidgetState<WidgetState>(createDefaultState);
  const [cartError, setCartError] = useState<string | null>(null);
  const { cartNotice, syncCartNotice } = useCartSyncNotice();
  const handoffRequestId = useRef(0);
  const busy = useRef(false);
  const [isSavingCart, setIsSavingCart] = useState(false);
  const cart = widgetState?.cartUrl ? widgetState.cart : [];
  const { canReviewCart, handleViewCart } = useCartReview({
    cart,
    cartUrl: widgetState?.cartUrl,
    connectionCartId: widgetState?.connectionCartId,
    onConnectedRefresh: (reply) => setWidgetState((previous) => mergeConnectedCartReply(previous, reply)),
    busy,
    setCartError,
  });

  const handleAddToCart = createCartAddHandler({
    widgetState,
    setWidgetState,
    setCartError,
    setIsSavingCart,
    syncCartNotice,
    handoffRequestId,
    busy,
  });

  const handleRemoveItem = async (productId: string) => {
    const host = widgetHost.get();
    if (busy.current) return;
    // Legacy conversations restore cart state without a token; with no
    // server cart to update, the line is dropped locally instead, which
    // needs no tool bridge.
    if (!widgetState?.cartToken && !widgetState?.connectionCartId) {
      setCartError(null);
      setWidgetState((previous) => dropLineFromCartState(previous, productId));
      return;
    }
    // No tool bridge: say so like the add path instead of silently
    // keeping a line the shopper asked to remove.
    if (!host?.callTool) {
      setCartError(
        'ChatGPT cannot open the cart here. Use Review on Ogabassey to continue.'
      );
      return;
    }
    busy.current = true;
    setIsSavingCart(true);
    setCartError(null);
    try {
      const response = await host?.callTool('update_ogabassey_guest_cart', {
        product_id: productId,
        quantity: 0,
        ...(widgetState?.connectionCartId ? {
          expectedVersion: widgetState.cartVersion, operationId: crypto.randomUUID(),
        } : { cart_token: widgetState?.cartToken }),
      });
      const connected = parseConnectedCartReply(readStructuredContent(response));
      if (widgetState?.connectionCartId) {
        if (!connected) {
          const fresh = await refreshConnectedCart(host.callTool.bind(host), widgetState.connectionCartId);
          setWidgetState((previous) => mergeConnectedCartReply(previous, fresh));
          syncCartNotice(fresh.items, widgetState.cart ?? [], productId);
          setCartError('Your connected cart changed. Please check it and try again.');
          return;
        }
        if (connected.cartId !== widgetState.connectionCartId ||
          connected.items.some((line) => line.product_id === productId)) throw new Error('Cart update failed');
        setWidgetState((previous) => mergeConnectedCartReply(previous, connected));
        syncCartNotice(connected.items, widgetState.cart ?? [], productId);
        return;
      }
      const content = parseCartToolOutput(readStructuredContent(response));
      if (content?.success === false && content.cart_expired === true) {
        // The server cart is gone, so the removed line is gone with it: drop
        // it locally and forget the dead token. (Tokenless removals are
        // rejected, so unlike adds this path cannot retry without the token.)
        setWidgetState((previous) =>
          dropLineFromCartState(previous, productId)
        );
        // No server lines can remain foreign: recompute the sync notice
        // against the empty server cart so a stale foreign-lines notice
        // clears instead of claiming hidden items with no Review path.
        syncCartNotice(
          [],
          (widgetState?.cart ?? []).filter(
            (item) => item.product.id !== productId
          ),
          productId
        );
        return;
      }
      const remaining = parseRemovalRemaining(
        content,
        widgetState?.cartToken ?? '',
        productId
      );
      // The cart_url check only narrows content for the merge below: a
      // non-null remaining already implies a valid success response.
      if (!remaining || !content?.cart_url)
        throw new Error('Cart update failed');
      const remainingQuantities = new Map(
        remaining.map((line) => [line.product_id, line.quantity])
      );
      setWidgetState((previous) => ({
        ...previous,
        cart: reconcileCartLineQuantities(
          previous?.cart,
          remainingQuantities,
          productId
        ),
        cartUrl: content.cart_url,
        // An emptied cart deletes its server file, so the returned token is
        // dead: forget it now so the next add mints directly instead of
        // paying for an expired-recovery round trip.
        cartToken: remaining.length === 0 ? undefined : previous?.cartToken,
      }));
      syncCartNotice(remaining, widgetState?.cart ?? [], productId);
    } catch {
      setCartError('Could not remove this item. Please try again.');
    } finally {
      busy.current = false;
      setIsSavingCart(false);
    }
  };

  return {
    cart,
    canReviewCart,
    cartError,
    cartNotice,
    isSavingCart,
    handleAddToCart,
    handleRemoveItem,
    handleViewCart,
  };
}
