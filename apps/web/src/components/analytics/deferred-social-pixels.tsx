'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import {
  getSocialMarketingConsent,
  getSocialServerConsent,
  isValidSnapchatPixelId,
  isValidTikTokPixelId,
  subscribeSocialMarketingConsent,
} from '@/lib/analytics/social-pixel-policy';
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
  usePreparedSocialPixel('tiktok', merchantId, tiktokId);
  usePreparedSocialPixel('snapchat', merchantId, snapchatId);
  return (
    <>
      {allowed && merchantId && tiktokId ? (
        <TikTokPixel key={`tiktok:${merchantId}`} pixelId={tiktokId} />
      ) : null}
      {allowed && merchantId && snapchatId ? (
        <SnapchatPixel key={`snapchat:${merchantId}`} pixelId={snapchatId} />
      ) : null}
    </>
  );
}
