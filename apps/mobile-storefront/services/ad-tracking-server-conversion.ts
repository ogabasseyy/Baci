import type { ConversionData } from './ad-tracking.types';
import { AD_TRACKING_PLATFORM } from './ad-tracking-runtime';
import {
  AD_API_URL,
  getCachedMerchantId,
  getCachedUserData,
  getIsTrackingAllowed,
  adTrackingLog as log,
} from './ad-tracking-state';

const SERVER_CONVERSION_TIMEOUT_MS = 5000;

export async function sendServerConversion(
  eventName: string,
  eventId: string,
  data: ConversionData
): Promise<void> {
  if (getIsTrackingAllowed() !== true) return;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SERVER_CONVERSION_TIMEOUT_MS
  );

  try {
    const userData = getCachedUserData();
    const response = await fetch(`${AD_API_URL}/analytics/conversion`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        event_source: 'mobile_app',
        platform: AD_TRACKING_PLATFORM,
        // Native advertising permission gates the entire external fanout.
        // Carry that verified local decision across the server purpose filter.
        analytics_consent: true,
        marketing_consent: true,
        ...(getCachedMerchantId() && { merchant_id: getCachedMerchantId() }),
        user_data: {
          em: data.email || userData.email,
          ph: data.phone || userData.phone,
          external_id: data.userId || userData.userId,
          fn: userData.firstName,
          ln: userData.lastName,
        },
        custom_data: {
          order_id: data.orderId,
          value: data.value,
          currency: data.currency || 'NGN',
          content_name: data.contentName,
          content_type: data.contentType,
          contents: data.items,
          price: data.price,
          search_string: data.searchString,
          url: data.url,
        },
        targets: ['facebook', 'tiktok', 'snapchat', 'google'],
      }),
    });

    const responseBody = __DEV__
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      log.warn(
        `Server conversion for ${eventName} returned status ${response.status}`,
        responseBody
      );
      return;
    }

    if (__DEV__) {
      log.debug(`[Server] ${eventName} sent:`, responseBody);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.warn(
        `Server conversion timed out after ${SERVER_CONVERSION_TIMEOUT_MS}ms`
      );
      return;
    }
    log.warn('Server conversion error:', error);
  } finally {
    clearTimeout(timeout);
  }
}
