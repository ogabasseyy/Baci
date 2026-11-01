'use client';

import { useSyncExternalStore } from 'react';
import { getSocialMarketingConsent } from '@/lib/analytics/get-social-marketing-consent';
import { getSocialServerConsent } from '@/lib/analytics/get-social-server-consent';
import { isValidSnapchatPixelId } from '@/lib/analytics/is-valid-snapchat-pixel-id';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { ActiveSnapchatPixel } from './active-snapchat-pixel';

interface SnapchatPixelProps {
  pixelId: string;
}

/**
 * Snapchat Pixel Component with Consent Mode Support
 *
 * @see https://businesshelp.snapchat.com/s/article/snap-pixel-about
 */
export function SnapchatPixel({ pixelId }: SnapchatPixelProps) {
  const validPixelId = isValidSnapchatPixelId(pixelId);
  const isAllowed = useSyncExternalStore(
    subscribeSocialMarketingConsent,
    getSocialMarketingConsent,
    getSocialServerConsent
  );

  return validPixelId && isAllowed ? (
    <ActiveSnapchatPixel key={pixelId} pixelId={pixelId} />
  ) : null;
}

export { snapchatEvents } from '@/lib/analytics/snapchat-pixel-events';
