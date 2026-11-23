import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { installChatwootMessageGuard } from './chatwoot-inbound-message-guard';
import {
  reconcileChatwootTenant,
  sealChatwootWidget,
} from './chatwoot-tenant-isolation';
import { containPreviousChatwootTenant } from './contain-chatwoot-previous-tenant';
import { reloadChatwootTenantDocument } from './reload-chatwoot-tenant-document';

export type ChatwootWidgetConfig = {
  platformOrigin: string;
  storefrontOrigin: string;
  websiteToken: string;
  storeSlug: string;
  checkoutEnabled?: boolean;
  oxygenHostedOrigins?: readonly string[];
};

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
  __baciChatwootContainedKey?: string;
  __baciChatwootPendingContainKey?: string;
};

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

function isCartOrCheckoutPath(
  pathname: string | null,
  storeSlug: string | undefined
): boolean {
  const segments = pathname?.split('/').filter(Boolean);
  if (!segments?.length) return false;
  const routeIndex = segments[0] === storeSlug ? 1 : 0;
  return segments[routeIndex] === 'cart' || segments[routeIndex] === 'checkout';
}

/**
 * Owns the Chatwoot widget lifecycle: SDK loading, readiness validation,
 * tenant resets, cart/checkout deferral and cleanup. Returns true once the
 * widget for the current tenant configuration is ready.
 */
export function useChatwootWidgetLifecycle(
  config: ChatwootWidgetConfig | null
): boolean {
  const pathname = usePathname();
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

  // Runs only when the whole storefront wrapper unmounts (for example a
  // navigation to an unpublished sibling store), where no replacement effect
  // exists to contain the previous widget.
  useEffect(
    () => () => containPreviousChatwootTenant(window as ChatwootWidgetWindow),
    []
  );

  useEffect(() => {
    let active = true;
    const widgetWindow = window as ChatwootWidgetWindow;
    const getCurrentWidget = () => widgetWindow.$chatwoot;
    const safeHide = () => {
      try {
        widgetWindow.$chatwoot?.toggleBubbleVisibility?.('hide');
      } catch {
        // The SDK throws before its bubble holder exists.
      }
    };
    const clearPreviousTenant = (): boolean => {
      const previousWidget = widgetWindow.$chatwoot;
      if (!previousWidget?.reset) {
        safeHide();
        setActiveWidgetKey(null);
        return false;
      }
      try {
        // v4.19.1 reset() removes the cookies, then reloads its iframe.
        previousWidget.reset();
      } catch {
        safeHide();
        setActiveWidgetKey(null);
        return false;
      }
      safeHide();
      // Keep the reloading iframe from rewriting the old cookie.
      sealChatwootWidget(widgetWindow);
      widgetWindow.__baciChatwootRunStarted = false;
      widgetWindow.__baciChatwootConfigKey = undefined;
      widgetWindow.__baciChatwootReadyKey = undefined;
      setActiveWidgetKey(null);
      return true;
    };

    const activeTenantKey = widgetWindow.__baciChatwootConfigKey;
    if (activeTenantKey && configKey && activeTenantKey !== configKey) {
      if (isCartOrCheckoutPath(pathname, storeSlug)) {
        // Keep shopper-entered cart/checkout state intact. The prior widget
        // stays hidden and tenant switching resumes on the next safe route.
        containPreviousChatwootTenant(widgetWindow);
        setActiveWidgetKey(null);
        return;
      }
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
      containPreviousChatwootTenant(widgetWindow);
      setActiveWidgetKey(null);
      return;
    }

    if (widgetWindow.__baciChatwootPendingContainKey === configKey) {
      widgetWindow.__baciChatwootPendingContainKey = undefined;
    }

    // A widget created outside this loader cannot be safely assigned to a tenant.
    if (
      widgetWindow.$chatwoot &&
      widgetWindow.__baciChatwootConfigKey !== configKey
    ) {
      safeHide();
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
      widgetWindow.__baciChatwootContainedKey = undefined;
      widgetWindow.$chatwoot.toggleBubbleVisibility?.('show');
      setActiveWidgetKey(configKey);
    }

    installChatwootMessageGuard(platformOrigin);
    widgetWindow.chatwootSettings ??= {};
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
        safeHide();
        setActiveWidgetKey(null);
        return;
      }
      reconcileChatwootTenant(configKey);
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
          ((initializedWidget.websiteToken !== undefined &&
            initializedWidget.websiteToken !== websiteToken) ||
            (initializedWidget.baseUrl !== undefined &&
              initializedWidget.baseUrl !== platformOrigin))
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
        !active ||
        widgetWindow.__baciChatwootConfigKey !== configKey ||
        !widgetWindow.__baciChatwootRunStarted
      ) {
        return;
      }
      const readyWidget = widgetWindow.$chatwoot;
      if (
        !readyWidget ||
        readyWidget.websiteToken !== websiteToken ||
        readyWidget.baseUrl !== platformOrigin
      ) {
        readyWidget?.toggleBubbleVisibility?.('hide');
        widgetWindow.__baciChatwootRunStarted = false;
        widgetWindow.__baciChatwootConfigKey = undefined;
        widgetWindow.__baciChatwootReadyKey = undefined;
        setActiveWidgetKey(null);
        return;
      }
      widgetWindow.__baciChatwootReadyKey = configKey;
      // A navigation between run() and ready hid the bubble in cleanup and the
      // replacement effect could not restore it yet, so show it here.
      readyWidget.toggleBubbleVisibility?.('show');
      setActiveWidgetKey(configKey);
    };
    window.addEventListener('chatwoot:ready', onReady);
    const cleanup = () => {
      active = false;
      window.removeEventListener('chatwoot:ready', onReady);
      safeHide(); // The ready handler shows the bubble later.
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
    pathname,
    websiteToken,
    validConfig,
  ]);

  return widgetStarted;
}
