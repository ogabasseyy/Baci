/**
 * Offline Conversions Service
 *
 * Unified service for sending purchase/conversion events to all configured
 * advertising platforms (Facebook, TikTok, GA4, Snapchat).
 *
 * This runs server-side when orders are marked as paid, ensuring:
 * - Events bypass ad blockers
 * - Accurate conversion attribution
 * - Better data for ad optimization
 */

import { type FacebookUserData, facebookCAPI } from './facebook-capi';
import {
  ga4MeasurementProtocol,
  generateClientId,
} from './ga4-measurement-protocol';
import { type SnapchatUserData, snapchatCAPI } from './snapchat-capi';
import { type TikTokUserData, tiktokEventsAPI } from './tiktok-events-api';

// Merchant analytics configuration
export interface MerchantAnalyticsConfig {
  // Facebook
  facebook_pixel_id?: string | null;
  facebook_capi_token?: string | null;
  // TikTok
  tiktok_pixel_id?: string | null;
  tiktok_access_token?: string | null;
  // Google Analytics 4
  google_analytics_id?: string | null;
  ga4_api_secret?: string | null;
  // Snapchat
  snapchat_pixel_id?: string | null;
  snapchat_capi_token?: string | null;
}

// Order data for conversion tracking
export interface OrderConversionData {
  orderId: string;
  orderNumber: string;
  total: number;
  currency: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  customerCountry?: string | null;
  items: Array<{
    id: string;
    name: string;
    price: number;
    quantity: number;
    category?: string;
  }>;
  // Optional tracking IDs from cookies/URL params
  fbclid?: string; // Facebook click ID
  fbc?: string; // Facebook click cookie with original click timestamp
  fbp?: string; // Facebook browser pixel ID
  ttp?: string; // TikTok browser ID
  ttclid?: string; // TikTok click ID
  gclid?: string; // Google click ID
  sccid?: string; // Snapchat click ID
  gaClientId?: string; // GA client ID from _ga cookie
  // Enhanced tracking for better Event Match Quality (EMQ)
  userIp?: string; // Client IP address
  userAgent?: string; // Client user agent
  eventId?: string; // For deduplication between Pixel and CAPI
  // Privacy compliance
  analyticsConsent?: boolean;
  marketingConsent?: boolean;
  limitedDataUse?: boolean; // CCPA/LDU flag - restricts data processing
}

// Result of sending conversions
export interface ConversionResult {
  platform: 'facebook' | 'tiktok' | 'ga4' | 'snapchat';
  success: boolean;
  error?: string;
}

/**
 * Send purchase conversion to all configured platforms
 *
 * This function is fire-and-forget - it will attempt to send to all platforms
 * and return results, but failures won't block the caller.
 */
export async function sendPurchaseConversion(
  merchantConfig: MerchantAnalyticsConfig,
  orderData: OrderConversionData
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = [];
  const promises: Promise<void>[] = [];

  // Facebook CAPI
  if (
    orderData.analyticsConsent === true &&
    merchantConfig.facebook_pixel_id &&
    merchantConfig.facebook_capi_token
  ) {
    const fbPromise = sendFacebookConversion(
      merchantConfig.facebook_pixel_id,
      merchantConfig.facebook_capi_token,
      orderData
    ).then((result) => {
      results.push({ platform: 'facebook', ...result });
    });
    promises.push(fbPromise);
  }

  // TikTok Events API
  if (
    orderData.marketingConsent === true &&
    merchantConfig.tiktok_pixel_id &&
    merchantConfig.tiktok_access_token
  ) {
    const ttPromise = sendTikTokConversion(
      merchantConfig.tiktok_pixel_id,
      merchantConfig.tiktok_access_token,
      orderData
    ).then((result) => {
      results.push({ platform: 'tiktok', ...result });
    });
    promises.push(ttPromise);
  }

  // GA4 Measurement Protocol
  if (
    orderData.analyticsConsent === true &&
    merchantConfig.google_analytics_id &&
    merchantConfig.ga4_api_secret
  ) {
    const gaPromise = sendGA4Conversion(
      merchantConfig.google_analytics_id,
      merchantConfig.ga4_api_secret,
      orderData
    ).then((result) => {
      results.push({ platform: 'ga4', ...result });
    });
    promises.push(gaPromise);
  }

  // Snapchat CAPI
  if (
    orderData.marketingConsent === true &&
    merchantConfig.snapchat_pixel_id &&
    merchantConfig.snapchat_capi_token
  ) {
    const snapPromise = sendSnapchatConversion(
      merchantConfig.snapchat_pixel_id,
      merchantConfig.snapchat_capi_token,
      orderData
    ).then((result) => {
      results.push({ platform: 'snapchat', ...result });
    });
    promises.push(snapPromise);
  }

  // Wait for all to complete (with timeout)
  await Promise.race([
    Promise.allSettled(promises),
    new Promise((resolve) => setTimeout(resolve, 10000)), // 10s timeout
  ]);

  return results;
}

/**
 * Generate Facebook fbc (click ID cookie) value from fbclid
 * Format: fb.1.{timestamp}.{fbclid}
 */
function generateFbc(fbclid: string): string {
  const timestamp = Date.now();
  return `fb.1.${timestamp}.${fbclid}`;
}

/**
 * Send conversion to Facebook CAPI
 * Includes support for:
 * - Event deduplication (event_id)
 * - Enhanced user matching (IP, User Agent)
 * - Limited Data Use for CCPA compliance
 */
async function sendFacebookConversion(
  pixelId: string,
  accessToken: string,
  orderData: OrderConversionData
): Promise<{ success: boolean; error?: string }> {
  try {
    // Generate fbc from fbclid if we have click ID but no browser ID
    const storedFbc = orderData.fbc?.trim();
    const fbc =
      storedFbc ||
      (orderData.fbclid ? generateFbc(orderData.fbclid) : undefined);

    const userData: FacebookUserData = {
      email: orderData.customerEmail || undefined,
      phone: orderData.customerPhone || undefined,
      externalId: orderData.customerId || undefined,
      city: orderData.customerCity || undefined,
      state: orderData.customerState || undefined,
      zipCode: orderData.customerZip || undefined,
      country: orderData.customerCountry || undefined,
      fbc: fbc, // Generated from fbclid for better attribution
      fbp: orderData.fbp, // Browser ID from _fbp cookie
      // Enhanced matching data for better Event Match Quality (EMQ)
      clientIpAddress: orderData.userIp,
      clientUserAgent: orderData.userAgent,
    };

    // Parse customer name if available
    if (orderData.customerName) {
      const nameParts = orderData.customerName.trim().split(' ');
      if (nameParts.length >= 2) {
        userData.firstName = nameParts[0];
        userData.lastName = nameParts.slice(1).join(' ');
      } else {
        userData.firstName = orderData.customerName;
      }
    }

    const result = await facebookCAPI.purchase(
      pixelId,
      accessToken,
      userData,
      orderData.orderNumber,
      orderData.total,
      orderData.currency,
      orderData.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
      undefined, // eventSourceUrl
      orderData.eventId, // For deduplication with client-side Pixel
      orderData.limitedDataUse // CCPA/LDU compliance
    );

    if (result.success) {
      console.log(
        `[Offline Conversions] Facebook: Purchase sent for order ${orderData.orderNumber}${orderData.eventId ? ` (eventId: ${orderData.eventId})` : ''}`
      );
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Offline Conversions] Facebook error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Send conversion to TikTok Events API
 * Includes IP/User Agent for better matching
 */
async function sendTikTokConversion(
  pixelId: string,
  accessToken: string,
  orderData: OrderConversionData
): Promise<{ success: boolean; error?: string }> {
  try {
    const userData: TikTokUserData = {
      email: orderData.customerEmail || undefined,
      phone: orderData.customerPhone || undefined,
      externalId: orderData.customerId || undefined,
      ttclid: orderData.ttclid,
      ttp: orderData.ttp,
      // Enhanced matching data
      ipAddress: orderData.userIp,
      userAgent: orderData.userAgent,
    };

    const result = await tiktokEventsAPI.purchase(
      pixelId,
      accessToken,
      userData,
      orderData.orderNumber,
      orderData.total,
      orderData.currency,
      orderData.items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })),
      { eventId: orderData.eventId }
    );

    if (result.success) {
      console.log(
        `[Offline Conversions] TikTok: Purchase sent for order ${orderData.orderNumber}`
      );
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Offline Conversions] TikTok error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Send conversion to GA4 Measurement Protocol
 */
async function sendGA4Conversion(
  measurementId: string,
  apiSecret: string,
  orderData: OrderConversionData
): Promise<{ success: boolean; error?: string }> {
  try {
    // Use provided client ID or generate one
    const clientId = orderData.gaClientId || generateClientId();

    const result = await ga4MeasurementProtocol.purchase(
      measurementId,
      apiSecret,
      {
        clientId,
        userId: orderData.customerId || undefined,
      },
      orderData.orderNumber,
      orderData.total,
      orderData.currency,
      orderData.items.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        category: item.category,
      }))
    );

    if (result.success) {
      console.log(
        `[Offline Conversions] GA4: Purchase sent for order ${orderData.orderNumber}`
      );
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Offline Conversions] GA4 error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Send conversion to Snapchat CAPI
 */
async function sendSnapchatConversion(
  pixelId: string,
  accessToken: string,
  orderData: OrderConversionData
): Promise<{ success: boolean; error?: string }> {
  try {
    const userData: SnapchatUserData = {
      email: orderData.customerEmail || undefined,
      phone: orderData.customerPhone || undefined,
      clickId: orderData.sccid,
    };

    const result = await snapchatCAPI.purchase(
      pixelId,
      accessToken,
      userData,
      orderData.orderNumber,
      orderData.total,
      orderData.currency,
      orderData.items.map((item) => item.id),
      orderData.eventId
    );

    if (result.success) {
      console.log(
        `[Offline Conversions] Snapchat: Purchase sent for order ${orderData.orderNumber}`
      );
    }

    return { success: result.success, error: result.error };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Offline Conversions] Snapchat error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Log conversion results summary
 */
export function logConversionResults(
  orderNumber: string,
  results: ConversionResult[]
): void {
  if (results.length === 0) {
    console.log(
      `[Offline Conversions] No platforms configured for order ${orderNumber}`
    );
    return;
  }

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(
    `[Offline Conversions] Order ${orderNumber}: ${successful.length}/${results.length} platforms succeeded`
  );

  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(
        `[Offline Conversions] ${failure.platform} failed: ${failure.error}`
      );
    }
  }
}
