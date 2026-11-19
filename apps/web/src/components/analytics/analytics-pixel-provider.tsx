'use client';

import { normalizeAnalyticsId } from './analytics-id';
import { GoogleAnalytics } from './google-analytics';

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

  // Advertising pixels live in the persistent storefront shell, once per store.
  return <>{gaId ? <GoogleAnalytics measurementId={gaId} /> : null}</>;
}
