'use client';

import { type ComponentType, useEffect, useState } from 'react';
import { normalizeAnalyticsId } from './analytics-id';
import type { AnalyticsPixelRuntimeProps } from './analytics-pixel-runtime';

export interface MerchantWithAnalytics {
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
  const gaId = normalizeAnalyticsId(merchant?.google_analytics_id);
  const fbPixelId = normalizeAnalyticsId(merchant?.facebook_pixel_id);
  const tiktokPixelId = normalizeAnalyticsId(merchant?.tiktok_pixel_id);
  const snapchatPixelId = normalizeAnalyticsId(merchant?.snapchat_pixel_id);
  const twitterPixelId = normalizeAnalyticsId(merchant?.twitter_pixel_id);
  const hasAnyPixel = Boolean(
    gaId || fbPixelId || tiktokPixelId || snapchatPixelId || twitterPixelId
  );

  const [RuntimeComponent, setRuntimeComponent] =
    useState<ComponentType<AnalyticsPixelRuntimeProps> | null>(null);

  useEffect(() => {
    if (!hasAnyPixel || RuntimeComponent) {
      return;
    }

    let cancelled = false;
    void import('./analytics-pixel-runtime').then((mod) => {
      if (!cancelled) {
        setRuntimeComponent(() => mod.AnalyticsPixelRuntime);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hasAnyPixel, RuntimeComponent]);

  if (!hasAnyPixel || !RuntimeComponent) {
    return null;
  }

  return (
    <RuntimeComponent
      fbPixelId={fbPixelId}
      gaId={gaId}
      snapchatPixelId={snapchatPixelId}
      tiktokPixelId={tiktokPixelId}
      twitterPixelId={twitterPixelId}
    />
  );
}
