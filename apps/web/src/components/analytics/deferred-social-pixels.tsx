'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import { getSocialMarketingConsent } from '@/lib/analytics/get-social-marketing-consent';
import { getSocialServerConsent } from '@/lib/analytics/get-social-server-consent';
import { isValidSnapchatPixelId } from '@/lib/analytics/is-valid-snapchat-pixel-id';
import { isValidTikTokPixelId } from '@/lib/analytics/is-valid-tiktok-pixel-id';
import { subscribeSocialMarketingConsent } from '@/lib/analytics/subscribe-social-marketing-consent';
import { usePreparedSocialPixel } from './use-prepared-social-pixel';

const TikTokPixel = dynamic(() =>
  import('./tiktok-pixel').then((module) => module.TikTokPixel)
);
const SnapchatPixel = dynamic(() =>
  import('./snapchat-pixel').then((module) => module.SnapchatPixel)
);

export function DeferredSocialPixels({
  merchantId,
  tiktokPixelId,
  snapchatPixelId,
}: {
  merchantId: string;
  tiktokPixelId?: string | null;
  snapchatPixelId?: string | null;
}) {
  const allowed = useSyncExternalStore(
    subscribeSocialMarketingConsent,
    getSocialMarketingConsent,
    getSocialServerConsent
  );
  const tiktokId =
    tiktokPixelId && isValidTikTokPixelId(tiktokPixelId) ? tiktokPixelId : null;
  const snapchatId =
    snapchatPixelId && isValidSnapchatPixelId(snapchatPixelId)
      ? snapchatPixelId
      : null;
  const tiktokEpoch = usePreparedSocialPixel('tiktok', merchantId, tiktokId);
  const snapchatEpoch = usePreparedSocialPixel(
    'snapchat',
    merchantId,
    snapchatId
  );
  return (
    <>
      {allowed && merchantId && tiktokId ? (
        <TikTokPixel
          key={`tiktok:${merchantId}:${tiktokEpoch}`}
          pixelId={tiktokId}
        />
      ) : null}
      {allowed && merchantId && snapchatId ? (
        <SnapchatPixel
          key={`snapchat:${merchantId}:${snapchatEpoch}`}
          pixelId={snapchatId}
        />
      ) : null}
    </>
  );
}
