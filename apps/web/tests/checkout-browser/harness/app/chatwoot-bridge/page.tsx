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

function ChatwootBridgeFixtureMount() {
  useChatwootInlineCartBridge('ogabassey', widgetOrigin);

  useEffect(() => {
    const untrustedFrame = document.getElementById('untrusted-chatwoot-widget');
    const observeUntrustedMessage = (event: MessageEvent) => {
      if (
        event.origin === untrustedWidgetOrigin &&
        event.source ===
          (untrustedFrame as HTMLIFrameElement | null)?.contentWindow
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
