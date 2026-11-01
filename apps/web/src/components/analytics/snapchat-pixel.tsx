'use client';

import { useSyncExternalStore } from 'react';
import { getStoredConsent } from '@/lib/consent-mode';
import { ActiveSnapchatPixel } from './active-snapchat-pixel';

interface SnapchatPixelProps {
  pixelId: string;
}

// Subscribe to consent changes via the storage + custom consent events.
// Using useSyncExternalStore (instead of useEffect + setState) lets React
// Compiler memoize the component and keeps the read free of a synchronous
// setState inside an effect.
function subscribeMarketingConsent(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}

function getMarketingConsentSnapshot(): boolean {
  return getStoredConsent()?.marketing === true;
}

function getMarketingConsentServerSnapshot(): boolean {
  return false;
}

/**
 * Snapchat Pixel Component with Consent Mode Support
 *
 * @see https://businesshelp.snapchat.com/s/article/snap-pixel-about
 */
export function SnapchatPixel({ pixelId }: SnapchatPixelProps) {
  const validPixelId =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      pixelId
    );
  const isAllowed = useSyncExternalStore(
    subscribeMarketingConsent,
    getMarketingConsentSnapshot,
    getMarketingConsentServerSnapshot
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
