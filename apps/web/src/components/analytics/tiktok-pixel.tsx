'use client';

import { useSyncExternalStore } from 'react';
import { getSocialMarketingConsent } from '@/lib/analytics/get-social-marketing-consent';
import { getSocialServerConsent } from '@/lib/analytics/get-social-server-consent';
import { isValidTikTokPixelId } from '@/lib/analytics/is-valid-tiktok-pixel-id';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
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
