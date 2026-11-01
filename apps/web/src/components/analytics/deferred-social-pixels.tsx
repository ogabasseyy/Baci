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
  tiktokPixelId,
  snapchatPixelId,
}: {
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
  useInsertionEffect(() => {
    if (!allowed) return;
    const releaseTikTok = tiktokId
      ? socialPixelContext.prepare('tiktok', tiktokId)
      : undefined;
    const releaseSnapchat = snapchatId
      ? socialPixelContext.prepare('snapchat', snapchatId)
      : undefined;
    return () => {
      releaseTikTok?.();
      releaseSnapchat?.();
    };
  }, [allowed, tiktokId, snapchatId]);
  return (
    <>
      {allowed && tiktokId ? <TikTokPixel pixelId={tiktokId} /> : null}
      {allowed && snapchatId ? <SnapchatPixel pixelId={snapchatId} /> : null}
    </>
  );
}
