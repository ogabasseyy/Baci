'use client';

import dynamic from 'next/dynamic';
import { useInsertionEffect, useSyncExternalStore } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { getStoredConsent } from '@/lib/consent-mode';

const TikTokPixel = dynamic(() =>
  import('./tiktok-pixel').then((module) => module.TikTokPixel)
);
const SnapchatPixel = dynamic(() =>
  import('./snapchat-pixel').then((module) => module.SnapchatPixel)
);

function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}
function marketingConsent(): boolean {
  return getStoredConsent()?.marketing === true;
}
function noServerConsent(): boolean {
  return false;
}

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
    subscribeConsent,
    marketingConsent,
    noServerConsent
  );
  const tiktokId =
    tiktokPixelId && /^[A-Za-z0-9]{1,64}$/.test(tiktokPixelId)
      ? tiktokPixelId
      : null;
  const snapchatId =
    snapchatPixelId &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      snapchatPixelId
    )
      ? snapchatPixelId
      : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: merchant changes must invalidate the owner even when pixel IDs match.
  useInsertionEffect(() => {
    let releaseTikTok: (() => void) | undefined;
    let releaseSnapchat: (() => void) | undefined;
    function syncOwners() {
      if (marketingConsent()) {
        if (tiktokId && !releaseTikTok)
          releaseTikTok = socialPixelContext.prepare('tiktok', tiktokId);
        if (snapchatId && !releaseSnapchat)
          releaseSnapchat = socialPixelContext.prepare('snapchat', snapchatId);
      } else {
        releaseTikTok?.();
        releaseSnapchat?.();
        releaseTikTok = undefined;
        releaseSnapchat = undefined;
      }
    }
    // A server snapshot is always false. Prepare from stored consent during
    // hydration before sibling layout effects can emit a funnel event.
    syncOwners();
    const unsubscribe = subscribeConsent(syncOwners);
    return () => {
      unsubscribe();
      releaseTikTok?.();
      releaseSnapchat?.();
    };
  }, [merchantId, tiktokId, snapchatId]);
  return (
    <>
      {allowed && tiktokId ? (
        <TikTokPixel key={merchantId} pixelId={tiktokId} />
      ) : null}
      {allowed && snapchatId ? (
        <SnapchatPixel key={merchantId} pixelId={snapchatId} />
      ) : null}
    </>
  );
}
