'use client';

import { useSyncExternalStore } from 'react';
import { getStoredConsent } from '@/lib/consent-mode';
import { ActiveTikTokPixel } from './active-tiktok-pixel';

interface TikTokPixelProps {
  pixelId: string;
}

/**
 * Subscribe to marketing-consent changes from the external consent store
 * (localStorage + custom events) so the pixel can sync without a
 * setState-in-effect, keeping React Compiler memoization enabled.
 */
function subscribeToConsent(onChange: () => void): () => void {
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
 * TikTok Pixel Component with Consent Mode Support
 *
 * @see https://business-api.tiktok.com/portal/docs?id=1739585696931842
 */
export function TikTokPixel({ pixelId }: TikTokPixelProps) {
  const validPixelId = /^[A-Za-z0-9]{1,64}$/.test(pixelId);
  const isAllowed = useSyncExternalStore(
    subscribeToConsent,
    getMarketingConsentSnapshot,
    getMarketingConsentServerSnapshot
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
