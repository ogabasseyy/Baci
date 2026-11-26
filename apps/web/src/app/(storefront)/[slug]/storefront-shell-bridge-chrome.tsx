import type { ExperienceManifest } from '@baci/shared/experience';
import { Suspense } from 'react';
import * as ReactDOM from 'react-dom';
import { buildMerchantAnalyticsSettings } from '@/components/analytics/analytics-merchant-settings';
import { ChatgptPixel } from '@/components/analytics/chatgpt-pixel';
import { DeferredGoogleStoreWidget } from '@/components/analytics/deferred-google-store-widget';
import { FacebookPixel } from '@/components/analytics/facebook-pixel';
import { SnapchatPixel } from '@/components/analytics/snapchat-pixel';
import { TikTokPixel } from '@/components/analytics/tiktok-pixel';
import { TwitterPixel } from '@/components/analytics/twitter-pixel';
import { CookieConsent } from '@/components/storefront/cookie-consent';
import { DeferredPageViewTracker } from '@/components/storefront/deferred-page-view-tracker';
import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';
import { StorefrontChromeRuntime } from '@/components/storefront/ogabassey/storefront-chrome-runtime';
import { OgabasseyHeaderCriticalStyle } from '@/components/storefront/ogabassey/storefront-header-critical-style';
import {
  getOgabasseyBasePath,
  shouldEnableOgabasseyGoogleStoreWidget,
} from '@/components/storefront/ogabassey/storefront-layout-utils';
import { ShellChromeLoading } from '@/components/storefront/ogabassey/storefront-loading-ui';
import { StorefrontSpeculationRules } from '@/components/storefront/ogabassey/storefront-speculation-rules';
import { WebMcpStorefrontTools } from '@/components/storefront/webmcp-storefront-tools';
import { OGABASSEY_TEMPLATE_ID } from '@/config/templates';
import type { StorefrontShellSnapshot } from '@/hooks/merchant/types';
import { getStorefrontChatwootWidgetConfig } from '@/lib/chatwoot/storefront-widget-config';
import { loadPublishedExperience } from '@/lib/experience/published-manifest';
import { getExperienceStorefrontRuntime } from '@/lib/experience/storefront-runtime';

export async function resolveBridgeExperienceRoutes(
  merchant: StorefrontShellSnapshot['merchant']
): Promise<ExperienceManifest['routes'] | null> {
  if (!getExperienceStorefrontRuntime()) {
    return null;
  }

  try {
    const experience = await loadPublishedExperience(merchant);
    return experience?.routes ?? null;
  } catch {
    return null;
  }
}

export function StorefrontBridgeHeadEffects({
  shellSnapshot,
}: {
  shellSnapshot: StorefrontShellSnapshot;
}) {
  const { merchant, routingMode } = shellSnapshot;
  const merchantSlug = merchant.slug || '';
  const analyticsSettings = buildMerchantAnalyticsSettings(merchant);
  const facebookPixelId = analyticsSettings?.facebook_pixel_id;
  const isOgabassey = merchant.template_id === OGABASSEY_TEMPLATE_ID;
  const basePath = isOgabassey
    ? getOgabasseyBasePath(merchant.slug, routingMode)
    : '';
  const shouldEnableGoogleStoreWidget = isOgabassey
    ? shouldEnableOgabasseyGoogleStoreWidget(merchant)
    : false;

  if (isOgabassey) {
    ReactDOM.prefetchDNS(OGABASSEY_CDN_ORIGIN);
    ReactDOM.preconnect(OGABASSEY_CDN_ORIGIN);
  }

  return (
    <>
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
      {analyticsSettings?.tiktok_pixel_id ? (
        <TikTokPixel pixelId={analyticsSettings.tiktok_pixel_id} />
      ) : null}
      {analyticsSettings?.snapchat_pixel_id ? (
        <SnapchatPixel pixelId={analyticsSettings.snapchat_pixel_id} />
      ) : null}
      <DeferredPageViewTracker merchantId={merchant.id} />
      <CookieConsent />
      {isOgabassey ? (
        <>
          <StorefrontSpeculationRules basePath={basePath} />
          <DeferredGoogleStoreWidget
            enabled={shouldEnableGoogleStoreWidget}
            homePath={basePath || '/'}
            merchant={merchant}
          />
          <div className="storefront-footer-slot">
            <Suspense fallback={<ShellChromeLoading />}>
              <StorefrontChromeRuntime
                basePath={basePath}
                merchant={merchant}
                section="footer"
              />
            </Suspense>
            <Suspense fallback={null}>
              <StorefrontChromeRuntime
                basePath={basePath}
                merchant={merchant}
                section="overlay"
              />
            </Suspense>
          </div>
        </>
      ) : null}
    </>
  );
}

export function StorefrontOgabasseyHeaderBridge({
  merchant,
  routingMode,
}: {
  merchant: StorefrontShellSnapshot['merchant'];
  routingMode: StorefrontShellSnapshot['routingMode'];
}) {
  if (merchant.template_id !== OGABASSEY_TEMPLATE_ID) {
    return null;
  }

  const basePath = getOgabasseyBasePath(merchant.slug, routingMode);

  return (
    <>
      <OgabasseyHeaderCriticalStyle />
      <StorefrontChromeRuntime
        basePath={basePath}
        merchant={merchant}
        section="header"
      />
    </>
  );
}

export function resolveBridgeChatwootConfig(
  merchant: StorefrontShellSnapshot['merchant']
) {
  const merchantSlug = merchant.slug || '';
  const chatwootConfig = getStorefrontChatwootWidgetConfig(merchant.id);
  return chatwootConfig && merchantSlug
    ? { ...chatwootConfig, storeSlug: merchantSlug }
    : null;
}
