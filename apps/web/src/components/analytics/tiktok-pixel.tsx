'use client';

import Script from 'next/script';
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { getStoredConsent } from '@/lib/consent-mode';
import { isMarketingAllowed } from '@/lib/marketing-consent';

interface TikTokPixelProps {
  pixelId: string;
}

/**
 * Subscribe to marketing-consent changes from the external consent store
 * (localStorage + custom events) so the pixel can sync without a
 * setState-in-effect, keeping React Compiler memoization enabled.
 */
function subscribeToConsent(onChange: () => void): () => void {
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
 * TikTok Pixel Component with Consent Mode Support
 *
 * @see https://business-api.tiktok.com/portal/docs?id=1739585696931842
 */
export function TikTokPixel({ pixelId }: TikTokPixelProps) {
  const validPixelId = /^[A-Za-z0-9]{1,64}$/.test(pixelId);
  const isAllowed = useSyncExternalStore(
    subscribeToConsent,
    getMarketingConsentSnapshot,
    getMarketingConsentServerSnapshot
  );

  useLayoutEffect(() => {
    if (!validPixelId || !isAllowed) return;
    const release = socialPixelContext.activate('tiktok', pixelId);
    return () => {
      window.ttq?.instance?.(pixelId).revokeConsent?.();
      release();
    };
  }, [pixelId, validPixelId, isAllowed]);

  function notifyPixelReady() {
    if (
      !isMarketingAllowed() ||
      socialPixelContext.get('tiktok')?.id !== pixelId
    )
      return;
    window.ttq?.instance?.(pixelId).grantConsent?.();
    socialPixelContext.markReady('tiktok', pixelId);
    window.dispatchEvent(new Event('baci-tiktok-ready'));
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

export { tiktokEvents } from '@/lib/analytics/tiktok-pixel-events';

// Extend Window type for TikTok
declare global {
  interface Window {
    ttq?: {
      track: (
        event: string,
        params?: Record<string, unknown>,
        options?: { event_id?: string }
      ) => void;
      page: () => void;
      identify: (params: Record<string, string>) => void;
      load: (pixelId: string) => void;
      instance?: (pixelId: string) => {
        track: (
          event: string,
          params?: Record<string, unknown>,
          options?: { event_id?: string }
        ) => void;
        revokeConsent?: () => void;
        grantConsent?: () => void;
        page: () => void;
        identify: (data: Record<string, string>) => void;
      };
    };
  }
}
