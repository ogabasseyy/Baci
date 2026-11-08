// Required because OgabasseyLayoutProviders and chrome children use client context/hooks.
'use client';

import { DeferredGoogleStoreWidget } from '@/components/analytics/deferred-google-store-widget';
import type { MerchantData } from '@/hooks/merchant/types';
import type React from 'react';
import { GadgetPattern } from './components/GadgetPattern';
import { type V2ThemeMode } from './providers/v2-theme-context';
import { OgabasseyLayoutChrome } from './storefront-layout-chrome';
import { OgabasseyLayoutProviders } from './storefront-layout-providers';
import {
  getOgabasseyBasePath,
  getOgabasseyLayoutStyle,
  shouldEnableOgabasseyGoogleStoreWidget,
} from './storefront-layout-utils';

interface OgabasseyLayoutProps {
  children: React.ReactNode;
  merchant?: MerchantData;
  /** Initial theme from server cookie - enables SSR consistency */
  initialTheme?: V2ThemeMode;
  /** Whether to hide navigation (header/footer) - e.g. for checkout or auth pages */
  hideNavigation?: boolean;
}

export function OgabasseyLayout({
  children,
  merchant,
  initialTheme,
  hideNavigation = false,
}: OgabasseyLayoutProps) {
  const basePath = getOgabasseyBasePath(merchant?.slug);
  const shouldEnableGoogleStoreWidget =
    shouldEnableOgabasseyGoogleStoreWidget(merchant);

  return (
    <>
      {merchant && (
        <DeferredGoogleStoreWidget
          merchant={merchant}
          enabled={shouldEnableGoogleStoreWidget}
        />
      )}

      <OgabasseyLayoutProviders initialTheme={initialTheme}>
        <div
          className="text-gray-900 bg-[#0F0F0F] min-h-screen flex flex-col relative overflow-hidden"
          style={getOgabasseyLayoutStyle(merchant)}
        >
          <GadgetPattern />
          <OgabasseyLayoutChrome
            merchant={merchant}
            basePath={basePath}
            hideNavigation={hideNavigation}
            section="header"
          />
          <main id="main-content" className="flex-1">
            {children}
          </main>
          <OgabasseyLayoutChrome
            merchant={merchant}
            basePath={basePath}
            hideNavigation={hideNavigation}
            section="footer"
          />
          <OgabasseyLayoutChrome
            merchant={merchant}
            basePath={basePath}
            hideNavigation={hideNavigation}
            section="overlay"
          />
        </div>
      </OgabasseyLayoutProviders>
    </>
  );
}
