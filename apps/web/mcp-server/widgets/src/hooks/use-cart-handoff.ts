import { useRef, useState } from 'react';
import { dropLineFromCartState } from '../drop-cart-line';
import { openOgabasseyUrl } from '../open-ogabassey-url';
import { resolveOptionAwareProductUrl } from '../option-aware-product-url';
import { getVariantSelectionUrl } from '../variant-selection-url';
import {
  parseCartToolOutput,
  readStructuredContent,
} from '../parse-cart-tool-output';
import { parseHandoffLines } from '../parse-handoff-lines';
import { recoverExpiredAdd } from '../recover-expired-add';
import { buildReviewCartUrl } from '../review-cart-url';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { useWidgetState } from './use-widget-state';

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
      // A stale token (expired or evicted cart) retries once without the
      // token so the server mints a fresh cart, replaying the surviving
      // lines so recovery preserves the shopper's cart. The final response
      // replaces prior state through the same merge below.
      if (
        widgetState?.cartToken &&
        parseCartToolOutput(readStructuredContent(result))?.cart_expired ===
          true
      ) {
        const callTool = window.openai.callTool.bind(window.openai);
        result = await recoverExpiredAdd(
          (args) => callTool('update_ogabassey_guest_cart', args),
          product.id,
          quantity,
          (widgetState?.cart ?? []).filter(
            (item) => item.product.id !== product.id
          )
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
    if (busy.current || !window.openai?.callTool) return;
    busy.current = true;
    setIsSavingCart(true);
    setCartError(null);
    // Legacy conversations restore cart state without a token; with no
    // server cart to update, the line is dropped locally instead.
    if (!widgetState?.cartToken) {
      setWidgetState((previous) => dropLineFromCartState(previous, productId));
      busy.current = false;
      setIsSavingCart(false);
      return;
    }
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
        return;
      }
      const url = content?.cart_url ? new URL(content.cart_url) : null;
      const raw = url?.searchParams.get('guest_cart') ?? null;
      // An emptied cart arrives as a bare /cart URL (legacy responses
      // carry guest_cart=[]); both mean no lines remain.
      const remaining =
        raw === null || raw === '[]' ? [] : parseHandoffLines(raw);
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
      // Another widget or direct tool call may have changed sibling lines
      // under this token: reconcile displayed survivors with the server
      // response like the add path does, instead of only dropping the
      // clicked product.
      const remainingQuantities = new Map(
        remaining.map((line) => [line.product_id, line.quantity])
      );
      setWidgetState((previous) => ({
        ...previous!,
        cart:
          previous?.cart
            .filter(
              (item) =>
                item.product.id !== productId &&
                remainingQuantities.has(item.product.id)
            )
            .map((item) => ({
              ...item,
              quantity:
                remainingQuantities.get(item.product.id) ?? item.quantity,
            })) || [],
        cartUrl: content.cart_url,
        // An emptied cart deletes its server file, so the returned token is
        // dead: forget it now so the next add mints directly instead of
        // paying for an expired-recovery round trip.
        cartToken:
          remaining.length === 0 ? undefined : previous?.cartToken,
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
      const reviewUrl = buildReviewCartUrl(widgetState.cartUrl);
      if (reviewUrl) openOgabasseyUrl(reviewUrl);
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
