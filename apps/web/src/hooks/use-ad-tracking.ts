'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  AD_ATTRIBUTION_UPDATED_EVENT,
  type AdTrackingData,
  generateEventId,
  getAdTrackingData,
  shouldApplyLimitedDataUse,
} from '@/lib/ad-tracking-cookies';

// The California/LDU snapshot derives from the (static) timezone, so its store
// never emits. An empty subscribe matches the original effect's `[]`-deps read.
function subscribeNoop(): () => void {
  return () => {
    // No-op: locale is static for the lifetime of the session.
  };
}

// Ad-tracking cookies are now set asynchronously by /api/attr (PR-ATTR) rather
// than synchronously by middleware, so on a direct ad→checkout landing the
// cookie can land AFTER this hook's first snapshot. Subscribe to the capture
// script's post-fetch event so useSyncExternalStore re-reads the cookies once
// they exist, before the order is submitted.
function subscribeAdTracking(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {
      // No client window: nothing to subscribe to.
    };
  }
  window.addEventListener(AD_ATTRIBUTION_UPDATED_EVENT, callback);
  return () => {
    window.removeEventListener(AD_ATTRIBUTION_UPDATED_EVENT, callback);
  };
}

// useSyncExternalStore requires a stable snapshot reference for unchanged data.
// getAdTrackingData() allocates a fresh object each call, so cache the last
// result and reuse it when the serialized value is unchanged.
let cachedTrackingData: AdTrackingData = {};
let cachedTrackingDataKey = '';

function getTrackingDataSnapshot(): AdTrackingData {
  const next = getAdTrackingData();
  const key = JSON.stringify(next);
  if (key !== cachedTrackingDataKey) {
    cachedTrackingData = next;
    cachedTrackingDataKey = key;
  }
  return cachedTrackingData;
}

const EMPTY_TRACKING_DATA: AdTrackingData = {};

function getTrackingDataServerSnapshot(): AdTrackingData {
  return EMPTY_TRACKING_DATA;
}

function getCaliforniaUserSnapshot(): boolean {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return shouldApplyLimitedDataUse(timezone);
  } catch {
    // Fallback: assume not California if we can't detect
    return false;
  }
}

function getCaliforniaUserServerSnapshot(): boolean {
  return false;
}

// Type definitions for ad tracking pixels on window
interface WindowWithAdPixels {
  fbq?: (
    action: string,
    event: string,
    params?: Record<string, unknown>,
    options?: { eventID: string }
  ) => void;
  ttq?: {
    track: (event: string, params: Record<string, unknown>) => void;
  };
  gtag?: (
    command: string,
    event: string,
    params: Record<string, unknown>
  ) => void;
  snaptr?: (
    action: string,
    event: string,
    params: Record<string, unknown>
  ) => void;
}

// Cast window to include ad tracking properties
const getWindow = (): WindowWithAdPixels | undefined => {
  if (typeof window !== 'undefined') {
    return window as unknown as WindowWithAdPixels;
  }
  return undefined;
};

/**
 * Hook for managing ad tracking data with event deduplication support
 *
 * This hook:
 * 1. Reads click IDs from cookies (set by middleware)
 * 2. Reads browser IDs from platform cookies (_fbp, _ttp, _ga)
 * 3. Generates event IDs for deduplication between Pixel and CAPI
 * 4. Detects California users for CCPA/LDU compliance
 * 5. Provides data ready to send with orders
 *
 * Usage:
 * ```tsx
 * const { trackingData, generatePurchaseEventId, getTrackingForOrder } = useAdTracking();
 *
 * // When firing a Pixel event
 * const eventId = generatePurchaseEventId();
 * fbq('track', 'Purchase', { value: 100, currency: 'NGN' }, { eventID: eventId });
 *
 * // When creating an order
 * const orderData = {
 *   ...orderDetails,
 *   ad_tracking: getTrackingForOrder(eventId),
 * };
 * ```
 */
export function useAdTracking() {
  // Read client-only cookie + locale values via useSyncExternalStore instead
  // of a mount effect + setState. This keeps the reads SSR-safe (server
  // snapshots match the pre-hydration markup) and lets React Compiler memoize
  // the hook, which a synchronous setState inside an effect would prevent.
  const trackingData = useSyncExternalStore(
    subscribeAdTracking,
    getTrackingDataSnapshot,
    getTrackingDataServerSnapshot
  );
  const isCaliforniaUser = useSyncExternalStore(
    subscribeNoop,
    getCaliforniaUserSnapshot,
    getCaliforniaUserServerSnapshot
  );
  const [purchaseEventId, setPurchaseEventId] = useState<string | null>(null);

  /**
   * Generate a new event ID for a purchase event
   * This ID should be used for BOTH the client-side Pixel event
   * AND passed in ad_tracking when creating the order
   */
  const generatePurchaseEventId = () => {
    const eventId = generateEventId();
    setPurchaseEventId(eventId);
    return eventId;
  };

  /**
   * Get tracking data formatted for order creation
   * Includes the event ID for deduplication if one was generated
   *
   * @param eventId - Optional event ID override (if not using generatePurchaseEventId)
   */
  const getTrackingForOrder = (eventId?: string): AdTrackingData => {
    return {
      ...trackingData,
      eventId: eventId || purchaseEventId || undefined,
      limitedDataUse: isCaliforniaUser,
    };
  };

  /**
   * Fire Facebook Pixel event with proper event ID for deduplication
   * Returns the event ID used (for passing to order creation)
   */
  const trackFacebookPurchase = (
    value: number,
    currency: string,
    contentIds?: string[]
  ) => {
    const eventId = generatePurchaseEventId();

    // Fire Facebook Pixel if available
    const win = getWindow();
    win?.fbq?.(
      'track',
      'Purchase',
      {
        value,
        currency,
        content_ids: contentIds,
        content_type: 'product_group',
      },
      { eventID: eventId }
    );

    return eventId;
  };

  /**
   * Fire TikTok Pixel event with proper event ID for deduplication
   * Returns the event ID used (for passing to order creation)
   */
  const trackTikTokPurchase = (
    value: number,
    currency: string,
    contentIds?: string[]
  ) => {
    const eventId = generatePurchaseEventId();

    // Fire TikTok Pixel if available
    const win = getWindow();
    win?.ttq?.track('CompletePayment', {
      value,
      currency,
      contents: contentIds?.map((id) => ({ content_id: id })),
      event_id: eventId,
    });

    return eventId;
  };

  /**
   * Fire purchase events on all configured platforms
   * Returns tracking data ready for order creation
   */
  const trackPurchase = (
    value: number,
    currency: string,
    contentIds?: string[]
  ): AdTrackingData => {
    const eventId = generatePurchaseEventId();
    const win = getWindow();

    // Fire Facebook Pixel
    win?.fbq?.(
      'track',
      'Purchase',
      {
        value,
        currency,
        content_ids: contentIds,
        content_type: 'product_group',
      },
      { eventID: eventId }
    );

    // Fire TikTok Pixel
    win?.ttq?.track('CompletePayment', {
      value,
      currency,
      contents: contentIds?.map((id) => ({ content_id: id })),
      event_id: eventId,
    });

    // Fire Google Analytics
    win?.gtag?.('event', 'purchase', {
      transaction_id: eventId,
      value,
      currency,
      items: contentIds?.map((id) => ({ item_id: id })),
    });

    // Fire Snapchat Pixel
    win?.snaptr?.('track', 'PURCHASE', {
      price: value,
      currency,
      transaction_id: eventId,
      item_ids: contentIds,
    });

    return getTrackingForOrder(eventId);
  };

  return {
    // Raw tracking data from cookies
    trackingData,
    // Privacy flags
    isCaliforniaUser,
    // Event ID management
    purchaseEventId,
    generatePurchaseEventId,
    // Helper to get data for order creation
    getTrackingForOrder,
    // Convenience methods for firing Pixel events with deduplication
    trackFacebookPurchase,
    trackTikTokPurchase,
    trackPurchase,
  };
}
