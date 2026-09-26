import { useRef, useState } from 'react';
import { getCartHandoffUrl } from '../cart-handoff-result';
import { getVariantSelectionUrl } from '../variant-selection-url';
import type { Product, WidgetState } from '../widget-types';
import { createDefaultState } from '../widget-types';
import { useWidgetState } from './use-widget-state';

function openOgabasseyUrl(url: string): void {
  if (window.openai?.openExternal) {
    window.openai.openExternal({ href: url });
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
    try {
      const result = await window.openai.callTool('add_to_cart', {
        product_id: product.id,
      });
      if (requestId !== handoffRequestId.current) return;

      const variantSelectionUrl = getVariantSelectionUrl(result, product.id, product.slug || product.id);
      if (variantSelectionUrl) {
        setWidgetState((previous) => ({ ...previous!, cart: [], cartUrl: undefined }));
        openOgabasseyUrl(variantSelectionUrl);
        return;
      }

      const cartUrl = getCartHandoffUrl(result, product.id);
      if (!cartUrl) {
        setCartError('This item cannot be added right now. Please choose another product.');
        return;
      }
      // The MCP handoff supports one product at a time.
      setWidgetState((previous) => ({
        ...previous!,
        cart: [{ product, quantity: 1 }],
        cartUrl,
      }));
      openOgabasseyUrl(cartUrl);
    } catch {
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
