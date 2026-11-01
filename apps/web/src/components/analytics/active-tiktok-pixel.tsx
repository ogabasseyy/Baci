'use client';

import Script from 'next/script';
import { useLayoutEffect, useRef } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { isMarketingAllowed } from '@/lib/marketing-consent';

export function ActiveTikTokPixel({ pixelId }: { pixelId: string }) {
  const owner = useRef<ReturnType<typeof socialPixelContext.get>>(undefined);

  useLayoutEffect(() => {
    const release = socialPixelContext.activate('tiktok', pixelId);
    const current = socialPixelContext.get('tiktok');
    owner.current = current;
    return () => {
      if (owner.current === current) owner.current = undefined;
      window.ttq?.instance?.(pixelId).revokeConsent?.();
      release();
    };
  }, [pixelId]);

  function notifyPixelReady() {
    if (
      !isMarketingAllowed() ||
      !owner.current ||
      socialPixelContext.get('tiktok') !== owner.current ||
      owner.current.id !== pixelId
    )
      return;
    window.ttq?.instance?.(pixelId).grantConsent?.();
    socialPixelContext.markReady('tiktok', pixelId);
    window.dispatchEvent(new Event('baci-tiktok-ready'));
  }

  return (
    // biome-ignore lint/correctness/useInlineScriptId: A per-pixel id is present; the rule misreads the onReady attribute.
    <Script
      key={pixelId}
      strategy="afterInteractive"
      onReady={notifyPixelReady}
      id={`tiktok-pixel-${pixelId}`}
    >
      {`
        !function (w, d, t) {
          w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
          ttq.load('${pixelId}');
          ttq.instance('${pixelId}').page();
        }(window, document, 'ttq');
      `}
    </Script>
  );
}
