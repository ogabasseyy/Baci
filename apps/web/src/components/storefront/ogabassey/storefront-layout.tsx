import { DeferredGoogleStoreWidget } from '@/components/analytics/deferred-google-store-widget';
import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';
import { StorefrontChromeRuntime } from '@/components/storefront/ogabassey/storefront-chrome-runtime';
import { ShellChromeLoading } from '@/components/storefront/ogabassey/storefront-loading-ui';
import { StorefrontShellLayout } from '@/components/storefront/ogabassey/storefront-shell-layout';
import { StorefrontSpeculationRules } from '@/components/storefront/ogabassey/storefront-speculation-rules';
import type { MerchantData } from '@/hooks/merchant/types';
import type React from 'react';
import * as ReactDOM from 'react-dom';
import { Suspense } from 'react';
import { type V2ThemeMode } from './providers/v2-theme-context';
import {
  getOgabasseyBasePath,
  shouldEnableOgabasseyGoogleStoreWidget,
} from './storefront-layout-utils';

interface OgabasseyStorefrontLayoutProps {
  children: React.ReactNode;
  merchant?: MerchantData;
  initialTheme?: V2ThemeMode;
  hideNavigation?: boolean;
  routingMode?: 'domain' | 'path';
  preloadHeroLcpImages?: boolean;
}

export function OgabasseyStorefrontLayout({
  children,
  merchant,
  initialTheme,
  hideNavigation = false,
  routingMode = 'path',
  preloadHeroLcpImages = false,
}: OgabasseyStorefrontLayoutProps) {
  ReactDOM.prefetchDNS(OGABASSEY_CDN_ORIGIN);
  ReactDOM.preconnect(OGABASSEY_CDN_ORIGIN);
  if (preloadHeroLcpImages) {
    // The hero LCP image is now a dynamic launch-product image (rendered eager
    // + fetchPriority="high" at the top of the tree, so it is discovered early),
    // not a single static URL we can <link rel=preload>. Warming the CDN
    // connection ahead of the streamed hero markup is the portable win here.
    ReactDOM.preconnect(OGABASSEY_CDN_ORIGIN, { crossOrigin: 'anonymous' });
  }

  const basePath = getOgabasseyBasePath(merchant?.slug, routingMode);
  const shouldEnableGoogleStoreWidget =
    shouldEnableOgabasseyGoogleStoreWidget(merchant);
  const headerLoadingFallback = hideNavigation ? null : (
    <div className="ogabassey-header-chrome-loading">
      <ShellChromeLoading />
    </div>
  );

  return (
    <>
      {/*
        Speculation Rules (SPEC-RULES): prerender the highest-value next
        navigation (listing/home -> PDP) at moderate eagerness and prefetch the
        broader category set. Emitted layout-wide so the rules cover links on
        every storefront page; cart/checkout/account and other per-user routes
        are excluded as targets. Analytics side effects are prerender-gated.
      */}
      <StorefrontSpeculationRules basePath={basePath} />
      {merchant && (
        <DeferredGoogleStoreWidget
          merchant={merchant}
          enabled={shouldEnableGoogleStoreWidget}
        />
      )}

      <StorefrontShellLayout
        footerChrome={
          <Suspense fallback={<ShellChromeLoading />}>
            <StorefrontChromeRuntime
              basePath={basePath}
              hideNavigation={hideNavigation}
              merchant={merchant}
              section="footer"
            />
          </Suspense>
        }
        headerChrome={
          <Suspense fallback={headerLoadingFallback}>
            <StorefrontChromeRuntime
              basePath={basePath}
              hideNavigation={hideNavigation}
              merchant={merchant}
              section="header"
            />
          </Suspense>
        }
        initialTheme={initialTheme}
        merchant={merchant}
        overlayChrome={
          <Suspense fallback={null}>
            <StorefrontChromeRuntime
              basePath={basePath}
              hideNavigation={hideNavigation}
              merchant={merchant}
              section="overlay"
            />
          </Suspense>
        }
      >
        {children}
      </StorefrontShellLayout>
    </>
  );
}
