'use client';

import { useSyncExternalStore } from 'react';
import {
  getSocialMarketingConsent,
  getSocialServerConsent,
  isValidSnapchatPixelId,
  subscribeSocialMarketingConsent,
} from '@/lib/analytics/social-pixel-policy';
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

// Extend Window type for Snapchat
declare global {
  interface Window {
    snaptr?: {
      (
        action: 'init',
        pixelId: string,
        userData?: Record<string, string>
      ): void;
      (action: 'track', event: string, params?: Record<string, unknown>): void;
      (
        action: 'track',
        pixelId: string,
        event: string,
        params?: Record<string, unknown>
      ): void;
    };
  }
}
