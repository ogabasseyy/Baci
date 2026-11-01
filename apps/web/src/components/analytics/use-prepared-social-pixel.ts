'use client';

import { useInsertionEffect } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import {
  getSocialMarketingConsent,
  subscribeSocialMarketingConsent,
} from '@/lib/analytics/social-pixel-policy';

/** Prepare each destination independently before sibling layout events. */
export function usePreparedSocialPixel(
  destination: 'tiktok' | 'snapchat',
  merchantId: string,
  pixelId: string | null
): void {
  useInsertionEffect(() => {
    if (!merchantId || !pixelId) return;
    let release: (() => void) | undefined;
    function syncOwner() {
      if (getSocialMarketingConsent()) {
        if (!release)
          release = socialPixelContext.prepare(destination, pixelId);
      } else {
        release?.();
        release = undefined;
      }
    }
    syncOwner();
    const unsubscribe = subscribeSocialMarketingConsent(syncOwner);
    return () => {
      unsubscribe();
      release?.();
    };
  }, [destination, merchantId, pixelId]);
}
