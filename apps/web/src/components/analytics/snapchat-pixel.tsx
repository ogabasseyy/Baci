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

/**
 * Snapchat E-commerce Event Tracking
 */
export const snapchatEvents = {
  /** Product view. */
  viewContent: (
    productId: string,
    price: number,
    currency: string = 'USD',
    eventId?: string,
    productIds: string[] = [productId]
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'VIEW_CONTENT',
      {
        item_ids: productIds,
        price,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /** Add to cart. */
  addToCart: (
    productId: string,
    price: number,
    currency: string = 'USD',
    eventId?: string,
    quantity = 1
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'ADD_CART',
      {
        item_ids: [productId],
        price: price * quantity,
        number_items: quantity,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /**
   * Track checkout initiation
   */
  startCheckout: (
    value: number,
    currency: string = 'USD',
    productIds: string[] = [],
    eventId?: string
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'START_CHECKOUT',
      {
        item_ids: productIds,
        price: value,
        currency,
        client_dedup_id: eventId,
      }
    );
  },

  /**
   * Track purchase completion
   */
  purchase: (
    orderId: string,
    value: number,
    currency: string = 'USD',
    productIds: string[] = []
  ) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'PURCHASE',
      {
        item_ids: productIds,
        price: value,
        currency,
        transaction_id: orderId,
      }
    );
  },

  /**
   * Track search
   */
  search: (searchTerm: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'SEARCH',
      {
        search_string: searchTerm,
      }
    );
  },

  /**
   * Track sign up
   */
  signUp: () => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    window.snaptr(
      'track',
      socialPixelContext.get('snapchat')?.id ?? '',
      'SIGN_UP'
    );
  },

  /**
   * Set user data for advanced matching
   * Note: User data should be set during pixel initialization.
   * This is called automatically if you pass user data to the PAGE_VIEW event.
   */
  setUserData: (pixelId: string, email?: string, phone?: string) => {
    if (
      !isMarketingAllowed() ||
      !socialPixelContext.get('snapchat')?.ready ||
      typeof window === 'undefined' ||
      !window.snaptr
    )
      return;

    const userData: Record<string, string> = {};
    if (email) userData.user_email = email;
    if (phone) userData.user_phone_number = phone;

    if (Object.keys(userData).length > 0) {
      // Re-initialize with user data
      window.snaptr('init', pixelId, userData);
    }
  },
};

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
