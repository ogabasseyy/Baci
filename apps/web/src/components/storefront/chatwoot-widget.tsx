'use client';

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { ChatwootInlineCartBridge } from './ogabassey/components/chat/chatwoot-inline-cart-bridge';
import { reloadChatwootTenantDocument } from './reload-chatwoot-tenant-document';

type ChatwootWidgetWindow = Window & {
  chatwootSDK?: {
    run: (options: { websiteToken: string; baseUrl: string }) => void;
  };
  $chatwoot?: {
    baseUrl?: string;
    hasLoaded?: boolean;
    reset?: () => void;
    toggleBubbleVisibility?: (visibility: 'show' | 'hide') => void;
    websiteToken?: string;
  };
  chatwootSettings?: Record<string, unknown>;
  __baciChatwootRunStarted?: boolean;
  __baciChatwootConfigKey?: string;
  __baciChatwootReadyKey?: string;
};

export type ChatwootWidgetConfig = {
  platformOrigin: string;
  storefrontOrigin: string;
  websiteToken: string;
  storeSlug: string;
};

const ChatwootSupportActiveContext = createContext(false);

export function useChatwootSupportActive(): boolean {
  return useContext(ChatwootSupportActiveContext);
}

function isExactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function ChatwootWidget({
  config,
  children,
}: {
  config: ChatwootWidgetConfig | null;
  children: ReactNode;
}) {
  const [activeWidgetKey, setActiveWidgetKey] = useState<string | null>(null);
  const validConfig =
    config !== null &&
    isExactHttpsOrigin(config.platformOrigin) &&
    isExactHttpsOrigin(config.storefrontOrigin) &&
    /^[A-Za-z0-9_-]{16,128}$/.test(config.websiteToken) &&
    config.storeSlug.length > 0;
  const platformOrigin = config?.platformOrigin;
  const storefrontOrigin = config?.storefrontOrigin;
  const websiteToken = config?.websiteToken;
  const storeSlug = config?.storeSlug;
  const configKey =
    validConfig && platformOrigin && storefrontOrigin && websiteToken
      ? `${platformOrigin}|${storefrontOrigin}|${websiteToken}`
      : '';
  const widgetStarted = Boolean(configKey && activeWidgetKey === configKey);

  useEffect(() => {
    let active = true;
    const widgetWindow = window as ChatwootWidgetWindow;
    const getCurrentWidget = () => widgetWindow.$chatwoot;
    const clearPreviousTenant = (): boolean => {
      const previousWidget = widgetWindow.$chatwoot;
      if (!previousWidget?.reset) {
        previousWidget?.toggleBubbleVisibility?.('hide');
        setActiveWidgetKey(null);
        return false;
      }
      try {
        previousWidget.reset();
      } catch {
        previousWidget.toggleBubbleVisibility?.('hide');
        setActiveWidgetKey(null);
        return false;
      }
      widgetWindow.$chatwoot?.toggleBubbleVisibility?.('hide');
      widgetWindow.__baciChatwootRunStarted = false;
      widgetWindow.__baciChatwootConfigKey = undefined;
      widgetWindow.__baciChatwootReadyKey = undefined;
      setActiveWidgetKey(null);
      return true;
    };

    const activeTenantKey = widgetWindow.__baciChatwootConfigKey;
    if (activeTenantKey && configKey && activeTenantKey !== configKey) {
      if (clearPreviousTenant()) reloadChatwootTenantDocument();
      return;
    }

    if (
      !platformOrigin ||
      !storefrontOrigin ||
      !websiteToken ||
      !storeSlug ||
      !validConfig ||
      window.location.origin !== storefrontOrigin
    ) {
      widgetWindow.$chatwoot?.toggleBubbleVisibility?.('hide');
      setActiveWidgetKey(null);
      return;
    }

    // A widget created outside this loader cannot be safely assigned to a tenant.
    if (
      widgetWindow.$chatwoot &&
      widgetWindow.__baciChatwootConfigKey !== configKey
    ) {
      widgetWindow.$chatwoot.toggleBubbleVisibility?.('hide');
      setActiveWidgetKey(null);
      return;
    }

    if (
      widgetWindow.__baciChatwootRunStarted &&
      widgetWindow.__baciChatwootConfigKey === configKey &&
      widgetWindow.__baciChatwootReadyKey === configKey &&
      widgetWindow.$chatwoot?.websiteToken === websiteToken &&
      widgetWindow.$chatwoot?.baseUrl === platformOrigin
    ) {
      widgetWindow.$chatwoot.toggleBubbleVisibility?.('show');
      setActiveWidgetKey(configKey);
    }

    widgetWindow.chatwootSettings = {};
    const scriptId = 'baci-chatwoot-sdk';
    const existingScript = document.getElementById(scriptId);
    const run = () => {
      if (
        !active ||
        !widgetWindow.chatwootSDK ||
        widgetWindow.__baciChatwootRunStarted
      ) {
        return;
      }
      const unownedWidget = getCurrentWidget();
      if (unownedWidget) {
        unownedWidget.toggleBubbleVisibility?.('hide');
        setActiveWidgetKey(null);
        return;
      }
      widgetWindow.__baciChatwootRunStarted = true;
      widgetWindow.__baciChatwootConfigKey = configKey;
      try {
        widgetWindow.chatwootSDK.run({
          websiteToken,
          baseUrl: platformOrigin,
        });
        const initializedWidget = getCurrentWidget();
        if (
          initializedWidget &&
          (initializedWidget.websiteToken !== websiteToken ||
            initializedWidget.baseUrl !== platformOrigin)
        ) {
          widgetWindow.__baciChatwootRunStarted = false;
          widgetWindow.__baciChatwootConfigKey = undefined;
          widgetWindow.__baciChatwootReadyKey = undefined;
          initializedWidget?.toggleBubbleVisibility?.('hide');
          setActiveWidgetKey(null);
        }
      } catch {
        widgetWindow.__baciChatwootRunStarted = false;
        widgetWindow.__baciChatwootConfigKey = undefined;
        setActiveWidgetKey(null);
      }
    };
    const onReady = () => {
      if (
        active &&
        widgetWindow.__baciChatwootConfigKey === configKey &&
        widgetWindow.__baciChatwootRunStarted &&
        widgetWindow.$chatwoot?.websiteToken === websiteToken &&
        widgetWindow.$chatwoot?.baseUrl === platformOrigin
      ) {
        widgetWindow.__baciChatwootReadyKey = configKey;
        setActiveWidgetKey(configKey);
      }
    };
    window.addEventListener('chatwoot:ready', onReady);
    const cleanup = () => {
      active = false;
      window.removeEventListener('chatwoot:ready', onReady);
      widgetWindow.$chatwoot?.toggleBubbleVisibility?.('hide');
      setActiveWidgetKey(null);
    };

    if (existingScript) {
      existingScript.addEventListener('load', run, { once: true });
      run();
      return cleanup;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `${platformOrigin}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', run, { once: true });
    script.addEventListener(
      'error',
      () => {
        if (script.isConnected) script.remove();
      },
      { once: true }
    );
    document.head.appendChild(script);
    return cleanup;
  }, [
    configKey,
    platformOrigin,
    storefrontOrigin,
    storeSlug,
    websiteToken,
    validConfig,
  ]);

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
