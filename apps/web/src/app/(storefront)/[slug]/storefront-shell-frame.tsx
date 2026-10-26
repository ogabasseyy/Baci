import { notFound } from 'next/navigation';
import type React from 'react';
import { buildMerchantAnalyticsSettings } from '@/components/analytics/analytics-merchant-settings';
import { ChatgptPixel } from '@/components/analytics/chatgpt-pixel';
import { FacebookPixel } from '@/components/analytics/facebook-pixel';
import { TwitterPixel } from '@/components/analytics/twitter-pixel';
import { CookieConsent } from '@/components/storefront/cookie-consent';
import { DeferredPageViewTracker } from '@/components/storefront/deferred-page-view-tracker';
import { WebMcpStorefrontTools } from '@/components/storefront/webmcp-storefront-tools';
import { StorefrontCartProvider } from '@/hooks/cart/storefront-cart-provider';
import { StorefrontMerchantProvider } from '@/hooks/merchant/storefront-merchant-provider';
import { merchantHasFeature } from '@/lib/merchant-has-feature';
import { StorefrontLayoutRenderer } from './storefront-layout-renderer';
import type { getStorefrontShellSnapshot } from './storefront-shell-snapshot';

export function StorefrontShellFrame({
  children,
  preloadHeroLcpImages,
  shellSnapshot,
}: {
  children: React.ReactNode;
  preloadHeroLcpImages: boolean;
  shellSnapshot: Awaited<ReturnType<typeof getStorefrontShellSnapshot>>;
}) {
  if (!shellSnapshot) {
    notFound();
  }

  const { merchant, routingMode } = shellSnapshot;
  const merchantSlug = merchant.slug || '';
  const analyticsSettings = buildMerchantAnalyticsSettings(merchant);
  const facebookPixelId = analyticsSettings?.facebook_pixel_id;

  return (
    <StorefrontMerchantProvider
      slug={merchantSlug}
      shellSnapshot={shellSnapshot}
    >
      <StorefrontCartProvider
        enableSmartCartPro
        merchantId={merchant.id}
        merchantSlug={merchantSlug}
        sharedCartEnabled={merchantHasFeature(merchant, 'shared_cart')}
        sharedCartAccountsEnabled={merchantHasFeature(
          merchant,
          'shared_cart_accounts'
        )}
        sharedCartRealtimeEnabled={merchantHasFeature(
          merchant,
          'shared_cart_realtime'
        )}
        deferValidationUntilIdle
      >
        <WebMcpStorefrontTools
          merchantId={merchant.id}
          merchantSlug={merchantSlug}
        />
        {shellSnapshot.chatgptPixelId ? (
          <ChatgptPixel pixelId={shellSnapshot.chatgptPixelId} />
        ) : null}
        {facebookPixelId ? <FacebookPixel pixelId={facebookPixelId} /> : null}
        {analyticsSettings?.twitter_pixel_id ? (
          <TwitterPixel
            pixelId={analyticsSettings.twitter_pixel_id}
            eventIds={analyticsSettings.twitter_event_ids}
          />
        ) : null}
        <DeferredPageViewTracker merchantId={merchant.id} />
        <CookieConsent />
        {/*
          Global Layout Wrapper logic:
          - Keeps layout persistent across route changes (seamless navigation)
          - Prevents header flashing/re-rendering
        */}
        <StorefrontLayoutRenderer
          merchant={merchant}
          preloadHeroLcpImages={preloadHeroLcpImages}
          routingMode={routingMode}
        >
          {children}
        </StorefrontLayoutRenderer>
      </StorefrontCartProvider>
    </StorefrontMerchantProvider>
  );
}
