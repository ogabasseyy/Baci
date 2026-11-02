'use client';

import { useInsertionEffect, useState } from 'react';
import { prepareFacebookPixel } from '@/lib/analytics/facebook-pixel-client';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { isAnalyticsAllowed } from '@/lib/analytics-consent';

export function usePreparedFacebookPixel(
  merchantId: string,
  pixelId: string,
  pathname: string | null
): number {
  const [consentEpoch, setConsentEpoch] = useState(0);
  useInsertionEffect(() => {
    if (!merchantId || !pixelId || !pathname) return;
    let release: (() => void) | undefined;
    function syncOwner() {
      if (isAnalyticsAllowed()) {
        if (!release) release = prepareFacebookPixel(pixelId, merchantId);
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
  }, [merchantId, pixelId, pathname]);
  return consentEpoch;
}
