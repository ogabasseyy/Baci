'use client';

import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import type { MerchantData } from '@/hooks/merchant/types';
import { runWhenPageActivated } from '@/lib/dom/run-when-page-activated';
import { setMerchantWidgetFrameHidden } from './google-store-widget-utils';

interface DeferredGoogleStoreWidgetProps {
  merchant?: Pick<MerchantData, 'custom_domain' | 'feature_settings'>;
  merchantCustomDomain?: string | null;
  enabled?: boolean;
  hostname?: string;
  loadWidgetModule?: () => Promise<GoogleStoreWidgetModule>;
}

interface GoogleStoreWidgetModule {
  GoogleStoreWidget: ComponentType<
    DeferredGoogleStoreWidgetProps & { skipActivationDelay?: boolean }
  >;
}

const GOOGLE_STORE_WIDGET_DELAY_MS = 20000;
const MAX_DEFERRED_WIDGET_LOAD_RETRIES = 2;

// The store-rating badge is fixed bottom-left and would cover critical UI on
// payment/checkout flows — including the embedded Credit Direct (Mono) consent
// checkbox shown in the mobile app's checkout WebView. Suppress it on those
// routes; it stays on browse/PDP pages where it belongs.
const SUPPRESSED_ROUTE_PATTERN =
  /(?:^|\/)(checkout|payment|pay|credit-direct|bnpl)(?:\/|$)/i;

function isSuppressedRoute(pathname: string | null): boolean {
  return Boolean(pathname) && SUPPRESSED_ROUTE_PATTERN.test(pathname ?? '');
}

// Module-scope dynamic import keeps the `import()` expression out of the
// component body — the React Compiler cannot lower import expressions, so
// inlining it would opt the component out of automatic memoization.
function importGoogleStoreWidgetModule(): Promise<GoogleStoreWidgetModule> {
  return import('./google-store-widget');
}

export function DeferredGoogleStoreWidget(
  props: DeferredGoogleStoreWidgetProps
) {
  const pathname = usePathname();
  const suppressed = isSuppressedRoute(pathname);
  const [Widget, setWidget] = useState<
    GoogleStoreWidgetModule['GoogleStoreWidget'] | null
  >(null);

  useEffect(() => {
    if (props.enabled === false || suppressed || Widget) {
      return;
    }

    let cancelled = false;
    let loading = false;
    let deferredLoadRetryCount = 0;
    let timeoutId: number | undefined;
    let cancelActivationGate: (() => void) | undefined;

    function clearLoadTimeout() {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        timeoutId = undefined;
      }
    }

    function scheduleDeferredLoad() {
      clearLoadTimeout();
      timeoutId = window.setTimeout(() => {
        // A speculatively prerendered PDP runs this component in a hidden tab;
        // firing the deferred load there would import and start the Google
        // merchant widget (third-party gstatic script + badge iframe) for a
        // page the shopper may never open. Defer the load until the page is
        // actually presented — a discarded prerender never activates. The
        // interaction listeners below are ungated because they cannot fire in a
        // hidden prerender.
        cancelActivationGate?.();
        cancelActivationGate = runWhenPageActivated(loadWidget);
      }, GOOGLE_STORE_WIDGET_DELAY_MS);
    }

    function removeDeferredWidgetListeners() {
      window.removeEventListener('pointerdown', loadWidget);
      window.removeEventListener('keydown', loadWidget);
    }

    function loadWidget(event?: Event) {
      if (cancelled || loading) {
        return;
      }

      if (event) {
        deferredLoadRetryCount = 0;
      }

      loading = true;
      clearLoadTimeout();

      const widgetModule = Promise.resolve().then(
        () => props.loadWidgetModule?.() ?? importGoogleStoreWidgetModule()
      );

      void widgetModule
        .then((module) => {
          if (!cancelled) {
            deferredLoadRetryCount = 0;
            removeDeferredWidgetListeners();
            setWidget(() => module.GoogleStoreWidget);
          }
        })
        .catch(() => {
          if (!cancelled) {
            loading = false;
            if (deferredLoadRetryCount < MAX_DEFERRED_WIDGET_LOAD_RETRIES) {
              deferredLoadRetryCount += 1;
              scheduleDeferredLoad();
            }
          }
        });
    }

    scheduleDeferredLoad();
    window.addEventListener('pointerdown', loadWidget, {
      passive: true,
    });
    window.addEventListener('keydown', loadWidget);

    return () => {
      cancelled = true;
      cancelActivationGate?.();
      clearLoadTimeout();
      removeDeferredWidgetListeners();
    };
  }, [Widget, props.enabled, props.loadWidgetModule, suppressed]);

  // The widget script injects a fixed badge iframe outside React. If it already
  // loaded on a browse/PDP route, returning null after a client-side navigation
  // to a suppressed route does NOT remove that existing frame — hide it here so
  // it can't cover checkout/payment UI; restore it when leaving the route.
  useEffect(() => {
    setMerchantWidgetFrameHidden(suppressed);

    if (!suppressed || typeof MutationObserver === 'undefined') {
      return;
    }

    // The script can append (or re-append) the badge iframe AFTER this effect
    // runs. A one-shot lookup would miss it, leaving a late frame covering the
    // payment UI — so keep hiding any inserted frame while the route stays
    // suppressed.
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
        setMerchantWidgetFrameHidden(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [suppressed]);

  if (props.enabled === false || suppressed || !Widget) {
    return null;
  }

  return <Widget {...props} skipActivationDelay />;
}
