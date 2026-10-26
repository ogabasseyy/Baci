'use client';

import { normalizeAnalyticsId } from './analytics-id';
import { GoogleAnalytics } from './google-analytics';
import { SnapchatPixel } from './snapchat-pixel';
import { TikTokPixel } from './tiktok-pixel';

export interface MerchantWithAnalytics {
  chatgpt_pixel_id?: string | null;
  google_analytics_id?: string | null;
  facebook_pixel_id?: string | null;
  tiktok_pixel_id?: string | null;
  snapchat_pixel_id?: string | null;
  twitter_pixel_id?: string | null;
  twitter_event_ids?: import('@/schemas/x-ads-settings').XEventIds;
}

interface AnalyticsPixelProviderProps {
  merchant?: MerchantWithAnalytics | null;
}

export function AnalyticsPixelProvider({
  merchant,
}: AnalyticsPixelProviderProps) {
  const gaId = normalizeAnalyticsId(merchant?.google_analytics_id);
  const tiktokPixelId = normalizeAnalyticsId(merchant?.tiktok_pixel_id);
  const snapchatPixelId = normalizeAnalyticsId(merchant?.snapchat_pixel_id);

  // Meta and ChatGPT measurement live in the persistent storefront shell, once per store.
  return (
    <>
      {gaId ? <GoogleAnalytics measurementId={gaId} /> : null}
      {tiktokPixelId ? <TikTokPixel pixelId={tiktokPixelId} /> : null}
      {snapchatPixelId ? <SnapchatPixel pixelId={snapchatPixelId} /> : null}
    </>
  );
}
