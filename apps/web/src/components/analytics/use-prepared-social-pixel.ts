'use client';

import { useInsertionEffect, useState } from 'react';
import { getSocialMarketingConsent } from '@/lib/analytics/get-social-marketing-consent';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';

/** Prepare each destination independently before sibling layout events. */
export function usePreparedSocialPixel(
  destination: 'tiktok' | 'snapchat',
  merchantId: string,
  pixelId: string | null
): number {
  const [consentEpoch, setConsentEpoch] = useState(0);
  useInsertionEffect(() => {
    if (!merchantId || !pixelId) return;
    const preparedPixelId = pixelId;
    let release: (() => void) | undefined;
    function syncOwner() {
      if (getSocialMarketingConsent()) {
        if (!release)
          release = socialPixelContext.prepare(destination, preparedPixelId);
      } else if (release) {
        release();
        release = undefined;
        setConsentEpoch((epoch) => epoch + 1);
      }
    }
    syncOwner();
    const unsubscribe = subscribeSocialMarketingConsent(syncOwner);
    return () => {
      unsubscribe();
      release?.();
    };
  }, [destination, merchantId, pixelId]);
  return consentEpoch;
}
