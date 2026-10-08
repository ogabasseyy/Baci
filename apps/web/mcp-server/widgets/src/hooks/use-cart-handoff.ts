import { useRef, useState } from 'react';
import { resolveOptionAwareProductUrl } from '../option-aware-product-url';
import { getVariantSelectionUrl } from '../variant-selection-url';
import { parseCartToolOutput } from '../parse-cart-tool-output';
import { parseHandoffLines } from '../parse-handoff-lines';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { useWidgetState } from './use-widget-state';

function readStructuredContent(response: unknown): unknown {
  return typeof response === 'object' && response !== null
    ? Reflect.get(response, 'structuredContent')
    : undefined;
}

function openOgabasseyUrl(url: string, pendingTab?: Window | null): boolean {
  if (window.openai?.openExternal) {
    window.openai.openExternal({ href: url });
    return true;
  } else if (pendingTab && !pendingTab.closed) {
    pendingTab.location.href = url;
    return true;
  } else {
    return window.open(url, '_blank') !== null;
  }
}

export function useCartHandoff() {
  const [widgetState, setWidgetState] =
    useWidgetState<WidgetState>(createDefaultState);
  const [cartError, setCartError] = useState<string | null>(null);
  const handoffRequestId = useRef(0);
  const busy = useRef(false);
  const [isSavingCart, setIsSavingCart] = useState(false);
  const cart = widgetState?.cartUrl ? widgetState.cart : [];

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
      // A stale token (expired or evicted cart) retries once without the
      // token so the server mints a fresh cart; the retry response replaces
      // prior state through the same merge below. Other failures retry never.
      if (
        widgetState?.cartToken &&
        parseCartToolOutput(readStructuredContent(result))?.cart_expired ===
          true
      ) {
        result = await window.openai.callTool(
          'update_ogabassey_guest_cart',
          {
            product_id: product.id,
            quantity,
            cart_token: undefined,
          }
        );
        if (requestId !== handoffRequestId.current) {
          pendingTab?.close();
          return;
        }
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
          ...(previous?.cart
            .filter(
              (item) =>
                item.product.id !== product.id &&
                quantities.has(item.product.id)
            )
            .map((item) => ({
              ...item,
              quantity: quantities.get(item.product.id) ?? item.quantity,
            })) || []),
          { product, quantity: quantities.get(product.id) ?? 1 },
        ],
        cartUrl,
        cartToken: content.cart_token,
      }));
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
    if (busy.current || !widgetState?.cartToken || !window.openai?.callTool)
      return;
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
        // it locally, forget the dead token, and rebuild the handoff URL from
        // the surviving lines. (Tokenless removals are rejected, so unlike
        // adds this path cannot retry without the token.)
        setWidgetState((previous) => {
          const survivors = (previous?.cart ?? []).filter(
            (item) => item.product.id !== productId
          );
          const review = new URL('https://ogabassey.com/cart');
          if (survivors.length > 0)
            review.searchParams.set(
              'guest_cart',
              JSON.stringify(
                survivors.map((item) => ({
                  product_id: item.product.id,
                  quantity: item.quantity,
                }))
              )
            );
          return {
            ...previous!,
            cart: survivors,
            cartUrl: survivors.length > 0 ? review.toString() : undefined,
            cartToken: undefined,
          };
        });
        return;
      }
      const url = content?.cart_url ? new URL(content.cart_url) : null;
      const raw = url?.searchParams.get('guest_cart') ?? null;
      const remaining = raw === '[]' ? [] : parseHandoffLines(raw);
      if (
        !content?.success ||
        content.cart_token !== widgetState.cartToken ||
        url?.origin !== 'https://ogabassey.com' ||
        url.pathname !== '/cart' ||
        url.username ||
        url.password ||
        !remaining ||
        remaining.some((line) => line.product_id === productId)
      )
        throw new Error('Cart update failed');
      setWidgetState((previous) => ({
        ...previous!,
        cart:
          previous?.cart.filter((item) => item.product.id !== productId) || [],
        cartUrl: content.cart_url,
      }));
    } catch {
      setCartError('Could not remove this item. Please try again.');
    } finally {
      busy.current = false;
      setIsSavingCart(false);
    }
  };

  const handleViewCart = () => {
    if (busy.current || cart.length === 0 || !widgetState?.cartUrl) return;
    try {
      const url = new URL(widgetState.cartUrl);
      if (
        url.origin !== 'https://ogabassey.com' ||
        url.pathname !== '/cart' ||
        url.username ||
        url.password
      )
        return;
      // Legacy one-shot `?item_id=&qty=` handoffs replay the add on every
      // open, so Review keeps only the idempotent `guest_cart` payload and
      // otherwise opens the bare cart.
      const guestCart = url.searchParams.get('guest_cart');
      const review = new URL('https://ogabassey.com/cart');
      if (guestCart) review.searchParams.set('guest_cart', guestCart);
      openOgabasseyUrl(review.toString());
    } catch {
      setCartError('Could not open your guest cart. Please try again.');
    }
  };

  return {
    cart,
    cartError,
    isSavingCart,
    handleAddToCart,
    handleRemoveItem,
    handleViewCart,
  };
}
