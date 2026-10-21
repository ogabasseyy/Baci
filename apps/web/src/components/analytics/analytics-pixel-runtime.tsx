'use client';

import { FacebookPixel } from './facebook-pixel';
import { GoogleAnalytics } from './google-analytics';
import { SnapchatPixel } from './snapchat-pixel';
import { TikTokPixel } from './tiktok-pixel';
import { TwitterPixel } from './twitter-pixel';

export interface AnalyticsPixelRuntimeProps {
  gaId: string | null;
  fbPixelId: string | null;
  tiktokPixelId: string | null;
  snapchatPixelId: string | null;
  twitterPixelId: string | null;
}

export function AnalyticsPixelRuntime({
  gaId,
  fbPixelId,
  tiktokPixelId,
  snapchatPixelId,
  twitterPixelId,
}: AnalyticsPixelRuntimeProps) {
  return (
    <>
      {gaId ? <GoogleAnalytics measurementId={gaId} /> : null}
      {fbPixelId ? <FacebookPixel pixelId={fbPixelId} /> : null}
      {tiktokPixelId ? <TikTokPixel pixelId={tiktokPixelId} /> : null}
      {snapchatPixelId ? <SnapchatPixel pixelId={snapchatPixelId} /> : null}
      {twitterPixelId ? <TwitterPixel pixelId={twitterPixelId} /> : null}
    </>
  );
}
