import { useRef, useState } from 'react';
import {
  dropLineFromCartState,
  reconcileCartLineQuantities,
} from '../drop-cart-line';
import { openOgabasseyUrl } from '../open-ogabassey-url';
import { resolveOptionAwareProductUrl } from '../option-aware-product-url';
import { getVariantSelectionUrl } from '../variant-selection-url';
import {
  parseCartToolOutput,
  readStructuredContent,
} from '../parse-cart-tool-output';
import { parseHandoffLines } from '../parse-handoff-lines';
import { parseRemovalRemaining } from '../parse-removal-remaining';
import { recoverCartAdd } from '../recover-expired-add';
import { useCartReview } from './use-cart-review';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
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
    busy,
    setCartError,
  });

  const handleAddToCart = async (product: Product) => {
    if (busy.current) return;
    const requestId = ++handoffRequestId.current;
    setCartError(null);
    // Option-bearing results open the PDP directly: the cart handoff rejects
    // variant/condition products, and its selection URL is slug-only, so a
    // tool call here would discard the matched option.
    const optionLink = resolveOptionAwareProductUrl(product);
    if (optionLink.hasOptions) {
      try {
        openOgabasseyUrl(optionLink.url);
      } catch {
        if (requestId !== handoffRequestId.current) return;
        setCartError('Could not open the cart. Please try again.');
      }
      return;
    }
    if (!window.openai?.callTool) {
      setCartError(
        'ChatGPT cannot open the cart here. Use Review on Ogabassey to continue.'
      );
      return;
    }
    busy.current = true;
    setIsSavingCart(true);
    // Popup blockers only honor tabs opened synchronously from the click, so
    // reserve one before the async tool call; it is closed when the response
    // needs no navigation.
    const pendingTab = window.openai?.openExternal
      ? null
      : window.open('about:blank', '_blank');
    try {
      // Guest quantities are absolute totals, so re-adding tops the line up
      // instead of resetting it to one.
      // Last-wins absolute quantities: the add target derives from local
      // widget state, so a stale view (e.g. a concurrent direct tool call)
      // can shrink the server line. Accepted: idempotent retries need
      // absolute totals, and the additive-only website transfer takes the
      // higher side, so the website cart never moves backward.
      const existingQuantity =
        widgetState?.cart.find((item) => item.product.id === product.id)
          ?.quantity ?? 0;
      const quantity = Math.min(existingQuantity + 1, 10);
      let result = await window.openai.callTool(
        'update_ogabassey_guest_cart',
        {
          product_id: product.id,
          quantity,
          cart_token: widgetState?.cartToken,
        }
      );
      if (requestId !== handoffRequestId.current) {
        pendingTab?.close();
        return;
      }
      // Recovery keeps the shopper's cart whole before the authoritative
      // merge: a stale token retries once without it, and a tokenless mint
      // replays pre-existing local lines into the fresh cart.
      const callTool = window.openai.callTool.bind(window.openai);
      const recovered = await recoverCartAdd(
        (args) => callTool('update_ogabassey_guest_cart', args),
        result,
        product.id,
        quantity,
        widgetState?.cartToken,
        widgetState?.cart ?? []
      );
      result = recovered.result;
      if (requestId !== handoffRequestId.current) {
        pendingTab?.close();
        return;
      }

      const variantSelectionUrl = getVariantSelectionUrl(result, product.id);
      if (variantSelectionUrl) {
        if (!openOgabasseyUrl(variantSelectionUrl, pendingTab)) {
          setCartError(
            'Could not open the product page. Please allow popups and try again.'
          );
        }
        // Option selection preserves the shopper's existing guest cart.
        return;
      }
      pendingTab?.close();

      const content = parseCartToolOutput(readStructuredContent(result));
      // Anonymous creation is throttled per address: choosing another
      // product cannot help, so say when the budget resets instead.
      if (content?.quota_exceeded === true) {
        const retrySeconds = content.retry_after_seconds;
        const minutes =
          typeof retrySeconds === 'number' && retrySeconds > 0
            ? Math.max(1, Math.ceil(retrySeconds / 60))
            : null;
        setCartError(
          minutes === null
            ? 'Too many guest carts were created from this address. Try again later.'
            : `Too many guest carts were created from this address. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
        );
        return;
      }
      // A full cart is recoverable by removing a line: choosing another
      // product cannot help, so say so instead of the generic message.
      if (content?.cart_full === true) {
        setCartError(
          'Your guest cart already holds 20 products. Remove one to add another.'
        );
        return;
      }
      const cartUrl = content?.success === true ? content.cart_url : undefined;
      let validatedUrl: URL | undefined;
      try {
        validatedUrl = cartUrl ? new URL(cartUrl) : undefined;
      } catch {
        /* Invalid tool response. */
      }
      const lines = parseHandoffLines(
        validatedUrl?.searchParams.get('guest_cart') ?? null
      );
      if (
        !cartUrl ||
        validatedUrl?.origin !== 'https://ogabassey.com' ||
        validatedUrl.pathname !== '/cart' ||
        validatedUrl.username ||
        validatedUrl.password ||
        !lines?.some((line) => line.product_id === product.id) ||
        !content?.cart_token
      ) {
        setCartError(
          'This item cannot be added right now. Please choose another product.'
        );
        return;
      }

      const quantities = new Map(
        lines.map((line) => [line.product_id, line.quantity])
      );
      setWidgetState((previous) => ({
        ...previous!,
        cart: [
          ...reconcileCartLineQuantities(
            previous?.cart,
            quantities,
            product.id
          ),
          { product, quantity: quantities.get(product.id) ?? 1 },
        ],
        cartUrl,
        cartToken: content.cart_token,
      }));
      // The merge drops recovery-skipped survivors: name their removal.
      // widgetState is pre-merge here, so it still holds the skipped lines.
      syncCartNotice(
        lines,
        widgetState?.cart ?? [],
        product.id,
        recovered.skippedSurvivors
      );
    } catch {
      pendingTab?.close();
      if (requestId !== handoffRequestId.current) return;
      setCartError('Could not save the guest cart. Please try again.');
    } finally {
      busy.current = false;
      setIsSavingCart(false);
    }
  };

  const handleRemoveItem = async (productId: string) => {
    if (busy.current) return;
    // Legacy conversations restore cart state without a token; with no
    // server cart to update, the line is dropped locally instead, which
    // needs no tool bridge.
    if (!widgetState?.cartToken) {
      setCartError(null);
      setWidgetState((previous) => dropLineFromCartState(previous, productId));
      return;
    }
    // No tool bridge: say so like the add path instead of silently
    // keeping a line the shopper asked to remove.
    if (!window.openai?.callTool) {
      setCartError(
        'ChatGPT cannot open the cart here. Use Review on Ogabassey to continue.'
      );
      return;
    }
    busy.current = true;
    setIsSavingCart(true);
    setCartError(null);
    try {
      const response = await window.openai.callTool(
        'update_ogabassey_guest_cart',
        {
          product_id: productId,
          quantity: 0,
          cart_token: widgetState.cartToken,
        }
      );
      const content = parseCartToolOutput(readStructuredContent(response));
      if (content?.success === false && content.cart_expired === true) {
        // The server cart is gone, so the removed line is gone with it: drop
        // it locally and forget the dead token. (Tokenless removals are
        // rejected, so unlike adds this path cannot retry without the token.)
        setWidgetState((previous) => dropLineFromCartState(previous, productId));
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
        widgetState.cartToken,
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
        ...previous!,
        cart: reconcileCartLineQuantities(
          previous?.cart,
          remainingQuantities,
          productId
        ),
        cartUrl: content.cart_url,
        // An emptied cart deletes its server file, so the returned token is
        // dead: forget it now so the next add mints directly instead of
        // paying for an expired-recovery round trip.
        cartToken:
          remaining.length === 0 ? undefined : previous?.cartToken,
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
