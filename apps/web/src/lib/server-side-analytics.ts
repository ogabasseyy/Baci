/**
 * Server-Side Analytics Service
 *
 * Unified interface for sending events to all server-side analytics platforms.
 * This should be called from checkout/purchase flows for accurate tracking.
 *
 * Supported platforms:
 * - Google Analytics 4 (Measurement Protocol)
 * - Facebook Conversions API
 * - TikTok Events API
 * - Snapchat Conversions API
 *
 * Benefits of server-side tracking:
 * - Bypasses ad blockers (captures 100% of events)
 * - More accurate attribution
 * - Better privacy compliance
 * - Reduced client-side JavaScript
 */

import { getAppUrl } from '@/env';
import { sendFacebookClientObservation } from './analytics/send-facebook-client-observation';

export interface ServerAnalyticsUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  externalId?: string;
}

export interface ServerAnalyticsProduct {
  id: string;
  name: string;
  price: number;
  quantity: number;
  category?: string;
}

export interface ServerAnalyticsEventData {
  value: number;
  currency: string;
  transactionId?: string;
  products: ServerAnalyticsProduct[];
}

interface AnalyticsResult {
  platform: string;
  success: boolean;
  error?: string;
  sent: boolean;
  queued?: boolean;
}

/**
 * Get the base URL for API calls
 * Works in both client and server environments
 */
function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  // Server-side: use type-safe environment variable
  return getAppUrl();
}

/**
 * Send server-side analytics events to all configured platforms
 *
 * @param merchantId - The merchant's ID
 * @param event - The event type
 * @param userData - User identification data
 * @param eventData - Event-specific data
 * @param options - Additional options like event source URL
 */
export async function sendServerSideAnalytics(
  merchantId: string,
  event: 'purchase' | 'begin_checkout' | 'add_to_cart' | 'view_item',
  userData: ServerAnalyticsUserData,
  eventData: ServerAnalyticsEventData,
  options?: {
    eventSourceUrl?: string;
    eventId?: string;
    clientId?: string; // GA4 client ID from _ga cookie
  }
): Promise<AnalyticsResult[]> {
  const results: AnalyticsResult[] = [];
  const baseUrl = getBaseUrl();

  // Prepare common request data
  const commonUserData = {
    email: userData.email,
    phone: userData.phone,
    firstName: userData.firstName,
    lastName: userData.lastName,
    city: userData.city,
    state: userData.state,
    zipCode: userData.zipCode,
    country: userData.country,
    externalId: userData.externalId,
  };

  const commonEventData = {
    value: eventData.value,
    currency: eventData.currency,
    transactionId: eventData.transactionId,
    orderId: eventData.transactionId, // TikTok uses orderId
    products: eventData.products,
  };

  // Fire all requests in parallel for performance
  const requests: Promise<void>[] = [];

  // 1. Google Analytics 4 Measurement Protocol
  requests.push(
    fetch(`${baseUrl}/api/analytics/ga4`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        merchantId,
        userData: { email: userData.email, userId: userData.externalId },
        eventData: commonEventData,
        clientId: options?.clientId,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        results.push({
          platform: 'GA4',
          success: data.success ?? false,
          error: data.error,
          sent: data.sent !== false,
        });
      })
      .catch((error) => {
        results.push({
          platform: 'GA4',
          success: false,
          error: error.message,
          sent: false,
        });
      })
  );

  // 2. Facebook Conversions API
  const fbEvent =
    event === 'purchase'
      ? 'Purchase'
      : event === 'begin_checkout'
        ? 'InitiateCheckout'
        : event === 'add_to_cart'
          ? 'AddToCart'
          : 'ViewContent';

  requests.push(
    sendFacebookClientObservation({
      baseUrl,
      event: fbEvent,
      merchantId,
      userData: commonUserData,
      eventData: commonEventData,
      eventSourceUrl: options?.eventSourceUrl,
      eventId: options?.eventId,
    }).then((result) => {
      results.push(result);
    })
  );

  // 3. TikTok Events API
  requests.push(
    fetch(`${baseUrl}/api/analytics/tiktok`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        merchantId,
        userData: {
          email: userData.email,
          phone: userData.phone,
          externalId: userData.externalId,
        },
        eventData: commonEventData,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        results.push({
          platform: 'TikTok',
          success: data.success ?? false,
          error: data.error,
          sent: data.sent !== false,
        });
      })
      .catch((error) => {
        results.push({
          platform: 'TikTok',
          success: false,
          error: error.message,
          sent: false,
        });
      })
  );

  // 4. Snapchat Conversions API
  requests.push(
    fetch(`${baseUrl}/api/analytics/snapchat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        merchantId,
        userData: {
          email: userData.email,
          phone: userData.phone,
        },
        eventData: commonEventData,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        results.push({
          platform: 'Snapchat',
          success: data.success ?? false,
          error: data.error,
          sent: data.sent !== false,
        });
      })
      .catch((error) => {
        results.push({
          platform: 'Snapchat',
          success: false,
          error: error.message,
          sent: false,
        });
      })
  );

  // Wait for all requests to complete
  await Promise.allSettled(requests);

  return results;
}

/**
 * Convenience function for tracking purchases
 */
export async function trackServerSidePurchase(
  merchantId: string,
  orderId: string,
  total: number,
  currency: string,
  products: ServerAnalyticsProduct[],
  customer: ServerAnalyticsUserData,
  options?: { eventSourceUrl?: string; clientId?: string }
): Promise<AnalyticsResult[]> {
  return await sendServerSideAnalytics(
    merchantId,
    'purchase',
    customer,
    {
      value: total,
      currency,
      transactionId: orderId,
      products,
    },
    options
  );
}

/**
 * Convenience function for tracking checkout initiation
 */
export async function trackServerSideBeginCheckout(
  merchantId: string,
  total: number,
  currency: string,
  products: ServerAnalyticsProduct[],
  customer?: ServerAnalyticsUserData,
  options?: { eventSourceUrl?: string; clientId?: string }
): Promise<AnalyticsResult[]> {
  return await sendServerSideAnalytics(
    merchantId,
    'begin_checkout',
    customer || {},
    {
      value: total,
      currency,
      products,
    },
    options
  );
}

export default {
  sendServerSideAnalytics,
  trackServerSidePurchase,
  trackServerSideBeginCheckout,
};
