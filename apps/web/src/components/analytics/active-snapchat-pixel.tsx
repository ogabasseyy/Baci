'use client';

import Script from 'next/script';
import { useLayoutEffect, useRef } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { isMarketingAllowed } from '@/lib/marketing-consent';

export function ActiveSnapchatPixel({ pixelId }: { pixelId: string }) {
  const owner = useRef<ReturnType<typeof socialPixelContext.get>>(undefined);

  useLayoutEffect(() => {
    const release = socialPixelContext.activate('snapchat', pixelId);
    const current = socialPixelContext.get('snapchat');
    owner.current = current;
    return () => {
      if (owner.current === current) owner.current = undefined;
      release();
    };
  }, [pixelId]);

  function notifyPixelReady() {
    if (
      !isMarketingAllowed() ||
      !owner.current ||
      socialPixelContext.get('snapchat') !== owner.current ||
      owner.current.id !== pixelId
    )
      return;
    socialPixelContext.markReady('snapchat', pixelId);
    window.dispatchEvent(new Event('baci-snapchat-ready'));
  }

  return (
    // biome-ignore lint/correctness/useInlineScriptId: A per-pixel id is present; the rule misreads the onReady attribute.
    <Script
      key={pixelId}
      strategy="afterInteractive"
      onReady={notifyPixelReady}
      id={`snapchat-pixel-${pixelId}`}
    >
      {`
        (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
        {a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
        a.queue=[];var s='script';r=t.createElement(s);r.async=!0;
        r.src=n;var u=t.getElementsByTagName(s)[0];
        u.parentNode.insertBefore(r,u);})(window,document,
        'https://sc-static.net/scevent.min.js');

        snaptr('init', '${pixelId}');
        snaptr('track', '${pixelId}', 'PAGE_VIEW');
      `}
    </Script>
  );
}
