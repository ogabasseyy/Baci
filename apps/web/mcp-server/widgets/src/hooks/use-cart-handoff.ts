import { useRef, useState } from 'react';
import { resolveOptionAwareProductUrl } from '../option-aware-product-url';
import { getVariantSelectionUrl } from '../variant-selection-url';
import { parseCartToolOutput } from '../parse-cart-tool-output';
import { parseHandoffLines } from '../parse-handoff-lines';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { useWidgetState } from './use-widget-state';

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
      const result = await window.openai.callTool(
        'update_ogabassey_guest_cart',
        {
          product_id: product.id,
          quantity: Math.min(existingQuantity + 1, 10),
          cart_token: widgetState?.cartToken,
        }
      );
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

      const content = parseCartToolOutput(
        typeof result === 'object' && result !== null
          ? Reflect.get(result, 'structuredContent')
          : undefined
      );
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
      const content = parseCartToolOutput(
        typeof response === 'object' && response !== null
          ? Reflect.get(response, 'structuredContent')
          : undefined
      );
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
      openOgabasseyUrl(url.toString());
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
