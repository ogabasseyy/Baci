'use client';

import { normalizeAnalyticsId } from './analytics-id';
import { ChatgptPixel } from './chatgpt-pixel';
import { FacebookPixel } from './facebook-pixel';
import { GoogleAnalytics } from './google-analytics';
import { SnapchatPixel } from './snapchat-pixel';
import { TikTokPixel } from './tiktok-pixel';
import { TwitterPixel } from './twitter-pixel';

export interface MerchantWithAnalytics {
  chatgpt_pixel_id?: string | null;
  google_analytics_id?: string | null;
  facebook_pixel_id?: string | null;
  tiktok_pixel_id?: string | null;
  snapchat_pixel_id?: string | null;
  twitter_pixel_id?: string | null;
}

interface AnalyticsPixelProviderProps {
  merchant?: MerchantWithAnalytics | null;
}

export function AnalyticsPixelProvider({
  merchant,
}: AnalyticsPixelProviderProps) {
  const chatgptPixelId = normalizeAnalyticsId(merchant?.chatgpt_pixel_id);
  const gaId = normalizeAnalyticsId(merchant?.google_analytics_id);
  const fbPixelId = normalizeAnalyticsId(merchant?.facebook_pixel_id);
  const tiktokPixelId = normalizeAnalyticsId(merchant?.tiktok_pixel_id);
  const snapchatPixelId = normalizeAnalyticsId(merchant?.snapchat_pixel_id);
  const twitterPixelId = normalizeAnalyticsId(merchant?.twitter_pixel_id);

  return (
    <>
      {chatgptPixelId ? <ChatgptPixel pixelId={chatgptPixelId} /> : null}
      {gaId ? <GoogleAnalytics measurementId={gaId} /> : null}
      {fbPixelId ? <FacebookPixel pixelId={fbPixelId} /> : null}
      {tiktokPixelId ? <TikTokPixel pixelId={tiktokPixelId} /> : null}
      {snapchatPixelId ? <SnapchatPixel pixelId={snapchatPixelId} /> : null}
      {twitterPixelId ? <TwitterPixel pixelId={twitterPixelId} /> : null}
    </>
  );
}
