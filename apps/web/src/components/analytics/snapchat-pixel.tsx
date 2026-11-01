'use client';

import Script from 'next/script';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { getStoredConsent } from '@/lib/consent-mode';
import { isMarketingAllowed } from '@/lib/marketing-consent';

interface SnapchatPixelProps {
  pixelId: string;
}

// Subscribe to consent changes via the storage + custom consent events.
// Using useSyncExternalStore (instead of useEffect + setState) lets React
// Compiler memoize the component and keeps the read free of a synchronous
// setState inside an effect.
function subscribeMarketingConsent(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}

function getMarketingConsentSnapshot(): boolean {
  return getStoredConsent()?.marketing === true;
}

function getMarketingConsentServerSnapshot(): boolean {
  return false;
}

/**
 * Snapchat Pixel Component with Consent Mode Support
 *
 * @see https://businesshelp.snapchat.com/s/article/snap-pixel-about
 */
export function SnapchatPixel({ pixelId }: SnapchatPixelProps) {
  const validPixelId =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      pixelId
    );
  const isAllowed = useSyncExternalStore(
    subscribeMarketingConsent,
    getMarketingConsentSnapshot,
    getMarketingConsentServerSnapshot
  );

  useLayoutEffect(() => {
    if (!validPixelId || !isAllowed) return;
    return socialPixelContext.activate('snapchat', pixelId);
  }, [pixelId, validPixelId, isAllowed]);

  function notifyPixelReady() {
    if (
      !isMarketingAllowed() ||
      socialPixelContext.get('snapchat')?.id !== pixelId
    )
      return;
    socialPixelContext.markReady('snapchat', pixelId);
    window.dispatchEvent(new Event('baci-snapchat-ready'));
  }

  if (!validPixelId || !isAllowed) {
    return null;
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

export { snapchatEvents } from '@/lib/analytics/snapchat-pixel-events';

// Extend Window type for Snapchat
declare global {
  interface Window {
    snaptr?: {
      (
        action: 'init',
        pixelId: string,
        userData?: Record<string, string>
      ): void;
      (action: 'track', event: string, params?: Record<string, unknown>): void;
      (
        action: 'track',
        pixelId: string,
        event: string,
        params?: Record<string, unknown>
      ): void;
    };
  }
}
