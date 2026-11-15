'use client';

import { createContext, type ReactNode, useContext } from 'react';
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

  return (
    <ChatwootSupportActiveContext.Provider value={widgetStarted}>
      {children}
      {widgetStarted && config ? (
        <ChatwootInlineCartBridge
          storeSlug={config.storeSlug}
          widgetOrigin={config.platformOrigin}
        />
      ) : null}
    </ChatwootSupportActiveContext.Provider>
  );
}
