import type React from 'react';
import type { MerchantData } from '@/hooks/merchant/types';
import type { V2ThemeMode } from './providers/v2-theme-context';
import { OgabasseyLayoutProviders } from './storefront-layout-providers';
import { getOgabasseyLayoutStyle } from './storefront-layout-utils';

interface StorefrontShellLayoutProps {
  children: React.ReactNode;
  merchant?: MerchantData;
  initialTheme?: V2ThemeMode;
  headerChrome?: React.ReactNode;
  footerChrome?: React.ReactNode;
  overlayChrome?: React.ReactNode;
}

export function StorefrontShellLayout({
  children,
  merchant,
  initialTheme,
  headerChrome,
  footerChrome,
  overlayChrome,
}: StorefrontShellLayoutProps) {
  return (
    <OgabasseyLayoutProviders initialTheme={initialTheme}>
      <div
        className="ogabassey-storefront-shell"
        style={getOgabasseyLayoutStyle(merchant)}
      >
        {headerChrome}
        <main
          id="main-content"
          className="ogabassey-storefront-main"
        >
          {children}
        </main>
        {footerChrome}
        {overlayChrome}
      </div>
    </OgabasseyLayoutProviders>
  );
}
