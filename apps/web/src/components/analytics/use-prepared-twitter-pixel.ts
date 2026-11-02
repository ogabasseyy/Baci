'use client';

import { useInsertionEffect, useState } from 'react';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import { prepareXPixel } from '@/lib/x-ads/pixel-client';

export function usePreparedTwitterPixel(
  merchantId: string,
  pixelId: string,
  serializedEvents: string
): number {
  const [epoch, setEpoch] = useState(0);
  useInsertionEffect(() => {
    if (!merchantId || !pixelId) return;
    let release: (() => void) | undefined;
    function syncOwner() {
      if (isMarketingAllowed()) {
        if (!release)
          release = prepareXPixel(
            pixelId,
            JSON.parse(serializedEvents),
            merchantId
          );
      } else if (release) {
        release();
        release = undefined;
        setEpoch((value) => value + 1);
      }
    }
    syncOwner();
    const unsubscribe = subscribeSocialMarketingConsent(syncOwner);
    return () => {
      unsubscribe();
      release?.();
    };
  }, [merchantId, pixelId, serializedEvents]);
  return epoch;
}
