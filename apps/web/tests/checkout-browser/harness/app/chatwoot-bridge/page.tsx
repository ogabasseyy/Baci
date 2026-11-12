'use client';

import { ChatwootInlineCartBridge } from '@/components/storefront/ogabassey/components/chat/chatwoot-inline-cart-bridge';
import { CartContext } from '@/hooks/cart/cart-context';
import type { CartContextType } from '@/hooks/cart/cart-types';

// This test-only host gives the bridge a deliberately untrusted local cart.
// The browser test verifies the displayed view comes from its mocked
// authorize response, not this deliberately forged local cart.
const cartContext = {
  cart: [
    {
      id: 'forged-product',
      name: 'Forged local name',
      price: 1,
      quantity: 99,
      cartItemId: 'forged-line',
    },
  ],
  isHydrated: true,
  merchantSlug: 'ogabassey',
  sharedCartEnabled: true,
  sharedCartRef: { cartId: 'fixture-cart-1', version: 8 },
} as unknown as CartContextType;

export default function ChatwootBridgeFixturePage() {
  return (
    <CartContext.Provider value={cartContext}>
      <main>
        <h1>Chatwoot bridge transport fixture</h1>
        <ChatwootInlineCartBridge
          storeSlug="ogabassey"
          widgetOrigin="https://support.example.test"
        />
        <div id="cw-widget-holder">
          <iframe
            id="chatwoot_live_chat_widget"
            title="Synthetic Chatwoot widget"
            src="https://support.example.test/widget"
          />
        </div>
      </main>
    </CartContext.Provider>
  );
}
