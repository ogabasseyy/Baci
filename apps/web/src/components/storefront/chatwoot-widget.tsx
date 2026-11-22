'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { useChatwootCustomerLink } from '@/hooks/use-chatwoot-customer-link';
import { ChatwootLauncherOverlayStyle } from './chatwoot-launcher-overlay-style';
import { ChatwootInlineCartBridge } from './ogabassey/components/chat/chatwoot-inline-cart-bridge';
import {
  type ChatwootWidgetConfig,
  useChatwootWidgetLifecycle,
} from './use-chatwoot-widget-lifecycle';

export type { ChatwootWidgetConfig };

const ChatwootSupportActiveContext = createContext(false);

export function useChatwootSupportActive(): boolean {
  return useContext(ChatwootSupportActiveContext);
}

export function ChatwootWidget({
  config,
  children,
}: {
  config: ChatwootWidgetConfig | null;
  children: ReactNode;
}) {
  const widgetStarted = useChatwootWidgetLifecycle(config);
  useChatwootCustomerLink(config?.storeSlug, widgetStarted);

  return (
    <ChatwootSupportActiveContext.Provider value={widgetStarted}>
      {children}
      {widgetStarted ? <ChatwootLauncherOverlayStyle /> : null}
      {widgetStarted && config ? (
        <ChatwootInlineCartBridge
          storeSlug={config.storeSlug}
          widgetOrigin={config.platformOrigin}
          checkoutEnabled={config.checkoutEnabled === true}
        />
      ) : null}
    </ChatwootSupportActiveContext.Provider>
  );
}
