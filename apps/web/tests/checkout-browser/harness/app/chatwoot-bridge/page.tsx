'use client';

import { useEffect } from 'react';
import { CartContext } from '@/hooks/cart/cart-context';
import type { CartContextType } from '@/hooks/cart/cart-types';
import { useChatwootInlineCartBridge } from '@/hooks/use-chatwoot-inline-cart-bridge';

const widgetOrigin = 'https://support.example.test';
const untrustedWidgetOrigin = 'https://untrusted.example.test';

// This test-only host gives the bridge a deliberately untrusted local cart.
// The browser test verifies the displayed view comes from its mocked
// authorize response, not this deliberately forged local cart.
const cartContext: CartContextType = {
  cart: [
    {
      id: 'forged-product',
      name: 'Forged local name',
      description: 'Synthetic product for the bridge harness',
      status: 'active',
      price: 1,
      manage_stock: false,
      stock: 999,
      image: '',
      imageLarge: '',
      imageHint: '',
      brand: 'Synthetic',
      gtin: '',
      mpn: '',
      quantity: 99,
      cartItemId: 'forged-line',
    },
  ],
  addToCart: () => 'rejected',
  removeFromCart: () => undefined,
  updateQuantity: () => undefined,
  clearCart: () => undefined,
  setMerchantSlug: () => undefined,
  cartCount: 99,
  cartTotal: 99,
  totalItems: 99,
  subtotal: 99,
  isCartOpen: false,
  setIsCartOpen: () => undefined,
  lastAddedProduct: null,
  showUpsell: false,
  dismissUpsell: () => undefined,
  hasSmartCartPro: false,
  isHydrated: true,
  merchantSlug: 'ogabassey',
  sharedCartEnabled: true,
  sharedCartRef: { cartId: 'fixture-cart-1', version: 8 },
};

function ChatwootBridgeFixtureMount() {
  useChatwootInlineCartBridge('ogabassey', widgetOrigin);

  useEffect(() => {
    const untrustedFrame = document.getElementById('untrusted-chatwoot-widget');
    const untrustedWindow =
      untrustedFrame instanceof HTMLIFrameElement
        ? untrustedFrame.contentWindow
        : null;
    const observeUntrustedMessage = (event: MessageEvent) => {
      if (
        event.origin === untrustedWidgetOrigin &&
        event.source === untrustedWindow
      ) {
        document.documentElement.dataset.untrustedMessageSeen = 'true';
      }
    };
    window.addEventListener('message', observeUntrustedMessage);
    // The bridge hook above registers its listener in an earlier useEffect;
    // React runs these passive effects in declaration order before this signal.
    document.documentElement.dataset.chatwootBridgeReady = 'true';
    return () => window.removeEventListener('message', observeUntrustedMessage);
  }, []);

  return null;
}

export default function ChatwootBridgeFixturePage() {
  return (
    <CartContext.Provider value={cartContext}>
      <main>
        <h1>Chatwoot bridge transport fixture</h1>
        <ChatwootBridgeFixtureMount />
        <div id="cw-widget-holder">
          <iframe
            id="chatwoot_live_chat_widget"
            title="Synthetic Chatwoot widget"
            src="https://support.example.test/widget"
          />
        </div>
        <iframe
          id="untrusted-chatwoot-widget"
          title="Untrusted synthetic widget"
          src="https://untrusted.example.test/widget"
        />
      </main>
    </CartContext.Provider>
  );
}
