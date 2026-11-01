'use client';

import { useSyncExternalStore } from 'react';
import {
  getSocialMarketingConsent,
  getSocialServerConsent,
  isValidTikTokPixelId,
  subscribeSocialMarketingConsent,
} from '@/lib/analytics/social-pixel-policy';
import { ActiveTikTokPixel } from './active-tiktok-pixel';

interface TikTokPixelProps {
  pixelId: string;
}

/**
 * TikTok Pixel Component with Consent Mode Support
 *
 * @see https://business-api.tiktok.com/portal/docs?id=1739585696931842
 */
export function TikTokPixel({ pixelId }: TikTokPixelProps) {
  const validPixelId = isValidTikTokPixelId(pixelId);
  const isAllowed = useSyncExternalStore(
    subscribeSocialMarketingConsent,
    getSocialMarketingConsent,
    getSocialServerConsent
  );

  return validPixelId && isAllowed ? (
    <ActiveTikTokPixel key={pixelId} pixelId={pixelId} />
  ) : null;
}

export { tiktokEvents } from '@/lib/analytics/tiktok-pixel-events';

// Extend Window type for TikTok
declare global {
  interface Window {
    ttq?: {
      track: (
        event: string,
        params?: Record<string, unknown>,
        options?: { event_id?: string }
      ) => void;
      page: () => void;
      identify: (params: Record<string, string>) => void;
      load: (pixelId: string) => void;
      instance?: (pixelId: string) => {
        track: (
          event: string,
          params?: Record<string, unknown>,
          options?: { event_id?: string }
        ) => void;
        revokeConsent?: () => void;
        grantConsent?: () => void;
        page: () => void;
        identify: (data: Record<string, string>) => void;
      };
    };
  }
}
