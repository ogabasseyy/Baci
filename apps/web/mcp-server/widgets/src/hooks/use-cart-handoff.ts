import { useRef, useState } from 'react';
import { getCartHandoffUrl } from '../cart-handoff-result';
import { getVariantSelectionUrl } from '../variant-selection-url';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { useWidgetState } from './use-widget-state';

function openOgabasseyUrl(url: string, pendingTab?: Window | null): void {
  if (window.openai?.openExternal) {
    window.openai.openExternal({ href: url });
  } else if (pendingTab) {
    pendingTab.location.href = url;
  } else {
    window.open(url, '_blank');
  }
}

export function useCartHandoff() {
  const [widgetState, setWidgetState] = useWidgetState<WidgetState>(createDefaultState);
  const [cartError, setCartError] = useState<string | null>(null);
  const handoffRequestId = useRef(0);
  const cart = widgetState?.cartUrl ? widgetState.cart : [];

  const handleAddToCart = async (product: Product) => {
    const requestId = ++handoffRequestId.current;
    setCartError(null);
    if (!window.openai?.callTool) {
      setCartError('ChatGPT cannot open the cart here. Use Review on Ogabassey to continue.');
      return;
    }
    // Reserve the fallback tab while the click still has a user gesture.
    const pendingTab = window.openai.openExternal ? null : window.open('about:blank', '_blank');
    if (!window.openai.openExternal && !pendingTab) {
      setCartError('Your browser blocked the cart tab. Allow popups or use Review on Ogabassey.');
      return;
    }
    try {
      const result = await window.openai.callTool('add_to_cart', {
        product_id: product.id,
      });
      if (requestId !== handoffRequestId.current) {
        pendingTab?.close();
        return;
      }

      const variantSelectionUrl = getVariantSelectionUrl(result, product.id, product.slug || product.id);
      if (variantSelectionUrl) {
        setWidgetState((previous) => ({ ...previous!, cart: [], cartUrl: undefined }));
        openOgabasseyUrl(variantSelectionUrl, pendingTab);
        return;
      }

      const cartUrl = getCartHandoffUrl(result, product.id);
      if (!cartUrl) {
        pendingTab?.close();
        setCartError('This item cannot be added right now. Please choose another product.');
        return;
      }
      // The MCP handoff supports one product at a time.
      setWidgetState((previous) => ({
        ...previous!,
        cart: [{ product, quantity: 1 }],
        cartUrl,
      }));
      openOgabasseyUrl(cartUrl, pendingTab);
    } catch {
      pendingTab?.close();
      if (requestId !== handoffRequestId.current) return;
      setCartError('Could not open the cart. Please try again.');
    }
  };

  const handleRemoveItem = (productId: string) => {
    handoffRequestId.current += 1;
    setWidgetState((previous) => ({
      ...previous!,
      cart: previous?.cart.filter((item) => item.product.id !== productId) || [],
      cartUrl: undefined,
    }));
  };

  const handleViewCart = () => {
    if (cart.length === 0 || !widgetState?.cartUrl) return;
    openOgabasseyUrl(widgetState.cartUrl);
  };

  return {
    cart,
    cartError,
    handleAddToCart,
    handleRemoveItem,
    handleViewCart,
  };
}
