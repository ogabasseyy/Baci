'use client';

import dynamic from 'next/dynamic';
import { Suspense, useSyncExternalStore } from 'react';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import type { XEventIds } from '@/schemas/x-ads-settings';
import { usePreparedTwitterPixel } from './use-prepared-twitter-pixel';

const TwitterPixel = dynamic(() =>
  import('./twitter-pixel').then((module) => module.TwitterPixel)
);
const serverConsent = () => false;
export function DeferredTwitterPixel({
  merchantId,
  pixelId,
  eventIds = {},
}: {
  merchantId: string;
  pixelId: string;
  eventIds?: XEventIds;
}) {
  const valid = /^[A-Za-z0-9]{1,64}$/.test(pixelId);
  const allowed = useSyncExternalStore(
    subscribeSocialMarketingConsent,
    isMarketingAllowed,
    serverConsent
  );
  const serializedEvents = JSON.stringify(
    Object.fromEntries(
      Object.entries(eventIds).sort(([a], [b]) => a.localeCompare(b))
    )
  );
  const epoch = usePreparedTwitterPixel(
    merchantId,
    valid ? pixelId : '',
    serializedEvents
  );
  if (!merchantId || !valid || !allowed) return null;
  return (
    <Suspense fallback={null}>
      <TwitterPixel
        key={`${merchantId}:${pixelId}:${serializedEvents}:${epoch}`}
        merchantId={merchantId}
        pixelId={pixelId}
        eventIds={eventIds}
      />
    </Suspense>
  );
}
