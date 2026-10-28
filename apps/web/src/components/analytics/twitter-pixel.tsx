'use client';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import {
  initializeXPixel,
  markXPixelReady,
  measureXEvent,
  resetXPixel,
} from '@/lib/x-ads/pixel-client';
import type { XEventIds } from '@/schemas/x-ads-settings';

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener('cookie-consent-updated', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener('cookie-consent-updated', onChange);
  };
}
const marketingAllowed = isMarketingAllowed;
const denied = () => false;
const EMPTY_EVENTS: XEventIds = {};
export function TwitterPixel({
  pixelId,
  eventIds = EMPTY_EVENTS,
}: {
  pixelId: string;
  eventIds?: XEventIds;
}) {
  const allowed = useSyncExternalStore(subscribe, marketingAllowed, denied);
  const pathname = usePathname();
  const serializedEvents = JSON.stringify(
    Object.fromEntries(
      Object.entries(eventIds).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    )
  );
  const activation = useRef<
    | { token: object | undefined; pixelId: string; serializedEvents: string }
    | undefined
  >(undefined);
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    const token = allowed
      ? initializeXPixel(pixelId, JSON.parse(serializedEvents))
      : undefined;
    activation.current = { token, pixelId, serializedEvents };
    return () => {
      if (token) resetXPixel(token);
    };
  }, [pixelId, serializedEvents, allowed]);
  useEffect(() => {
    if (
      allowed &&
      pathname &&
      activation.current?.pixelId === pixelId &&
      activation.current.serializedEvents === serializedEvents
    )
      measureXEvent('pageView', { conversion_id: crypto.randomUUID() });
  }, [allowed, pixelId, serializedEvents, pathname]);
  useEffect(() => {
    if (
      sdkReady &&
      allowed &&
      activation.current?.pixelId === pixelId &&
      activation.current.serializedEvents === serializedEvents
    )
      markXPixelReady(activation.current.token);
  }, [sdkReady, allowed, pixelId, serializedEvents]);
  return allowed && /^[A-Za-z0-9]{1,64}$/.test(pixelId) ? (
    <Script
      id="twitter-pixel"
      src="https://static.ads-twitter.com/uwt.js"
      strategy="afterInteractive"
      onReady={() => setSdkReady(true)}
    />
  ) : null;
}
// Deprecated wrappers retain the existing exports while using configured event codes.
export const twitterEvents = {
  viewContent: (
    productId: string,
    value?: number,
    currency = 'USD',
    eventId = crypto.randomUUID()
  ) =>
    measureXEvent('viewContent', {
      conversion_id: eventId,
      currency,
      value,
      contents: [{ content_id: productId, content_price: value, num_items: 1 }],
    }),
  addToCart: (
    productId: string,
    value: number,
    currency = 'USD',
    eventId = crypto.randomUUID()
  ) =>
    measureXEvent('addToCart', {
      conversion_id: eventId,
      currency,
      value,
      contents: [{ content_id: productId, num_items: 1 }],
    }),
  initiateCheckout: (
    value: number,
    currency = 'USD',
    productIds: string[] = [],
    eventId = crypto.randomUUID()
  ) =>
    measureXEvent('initiateCheckout', {
      conversion_id: eventId,
      value,
      currency,
      contents: productIds.map((content_id) => ({ content_id, num_items: 1 })),
    }),
  purchase: (
    _orderId: string,
    _value: number,
    _currency = 'USD',
    _productIds: string[] = [],
    _numItems?: number
  ) => undefined,
  search: (searchTerm: string) =>
    measureXEvent('search', {
      search_string: searchTerm,
      conversion_id: crypto.randomUUID(),
    }),
  signUp: () => measureXEvent('signUp', { conversion_id: crypto.randomUUID() }),
  addToWishlist: (productId: string, value?: number, currency = 'USD') =>
    measureXEvent('addToWishlist', {
      currency,
      value,
      contents: [{ content_id: productId }],
      conversion_id: crypto.randomUUID(),
    }),
};
