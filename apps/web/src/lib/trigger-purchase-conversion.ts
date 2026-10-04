/**
 * Shared utility for triggering purchase conversion events to ad platforms
 * 2026 Best Practice: Centralized, properly typed, and awaitable
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchAnalyticsPlatformConfig,
  hasConfiguredAnalyticsPlatform,
} from '@/lib/analytics/analytics-platform-config';
import { enqueuePaidOrderDomainEvent } from '@/lib/events/enqueue-paid-order-domain-event';
import {
  isEventPipelineEnqueueEnabled,
  isLegacyAnalyticsFanoutDisabled,
} from '@/lib/events/event-pipeline-config';
import { toConversionOrderItems } from '@/lib/events/to-conversion-order-items';
import { logger } from '@/lib/logger';
import {
  logConversionResults,
  type MerchantAnalyticsConfig,
  type OrderConversionData,
  sendPurchaseConversion,
} from '@/lib/offline-conversions';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

/**
 * Strongly typed interface for order data needed for conversions
 * Avoids `any` and provides clear contract
 */
export interface OrderForConversion {
  id: string;
  order_number?: string | null;
  total: string | number;
  currency?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  customer_id?: string | null;
  occurredAt?: string;
  ad_tracking?: Record<string, unknown> | null;
  order_items?: Array<{
    id?: string | null;
    product_id?: string | null;
    name?: string | null;
    price?: number | string | null;
    quantity?: number | null;
  }> | null;
  shipping_address?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
    zip?: string | null;
    postal_code?: string | null;
  } | null;
}

export interface TriggerPurchaseConversionOptions {
  deliveryMode?: 'automatic' | 'enqueue_only' | 'legacy_only';
  failOnInvalidItem?: boolean;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Resolve the currency code for a conversion event. The order's own
 * `currency` column is authoritative when present (set at checkout from the
 * merchant's resolved currency); only when it's missing do we fall back to
 * looking up the merchant's `payout_currency`/`country` via the shared
 * resolver (which itself falls back to the platform default, NGN).
 */
async function resolveConversionCurrency(
  supabase: SupabaseClient,
  merchantId: string,
  order: OrderForConversion
): Promise<string> {
  const orderCurrency = order.currency?.trim();
  if (orderCurrency) {
    return orderCurrency;
  }

  const { data: merchant, error } = await supabase
    .from('merchants')
    .select('country, payout_currency')
    .eq('id', merchantId)
    .maybeSingle();

  if (error) {
    logger.warn({
      message:
        'Failed to resolve merchant for conversion currency; using platform fallback',
      merchantId,
      error,
    });
  }

  return resolveMerchantCurrencyConfig(merchant ?? {}).code;
}

/**
 * Triggers a Purchase conversion event to all configured ad platforms
 * (Facebook CAPI, TikTok Events API, Google Analytics 4, Snapchat CAPI)
 *
 * @param supabase - Supabase client (admin or authenticated)
 * @param merchantId - The merchant's UUID
 * @param order - Order data for the conversion
 * @returns Promise that resolves when conversion tracking completes
 *
 * @example
 * // In an API route with `after()` for background processing:
 * import { after } from 'next/server';
 * after(() => triggerPurchaseConversion(supabase, merchantId, order));
 */
export async function triggerPurchaseConversion(
  supabase: SupabaseClient,
  merchantId: string,
  order: OrderForConversion,
  options: TriggerPurchaseConversionOptions = {}
): Promise<{ alreadyEnqueued: boolean } | undefined> {
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const suppliedEventId = order.ad_tracking?.eventId;
  const stableEventId =
    typeof suppliedEventId === 'string' && suppliedEventId.trim()
      ? suppliedEventId.trim()
      : `purchase_${order.id}`;

  try {
    const deliveryMode = options.deliveryMode ?? 'automatic';
    if (deliveryMode !== 'legacy_only' && isEventPipelineEnqueueEnabled()) {
      const enqueueResult = await enqueuePaidOrderDomainEvent(supabase, {
        externalEventId: stableEventId,
        merchantId,
        occurredAt: order.occurredAt,
        orderId: order.id,
      });
      logger.info({
        message: 'Paid-order conversion durably enqueued',
        merchantId,
        orderId: order.id,
      });
      if (
        deliveryMode === 'enqueue_only' ||
        isLegacyAnalyticsFanoutDisabled()
      ) {
        return { alreadyEnqueued: enqueueResult.already_enqueued };
      }
    } else if (deliveryMode === 'enqueue_only') {
      throw new Error('event_pipeline_enqueue_disabled');
    }

    // Every legacy path, including enqueue-disabled and legacy_only callers,
    // must retain merchant authority before reading provider credentials.
    if (isLegacyAnalyticsFanoutDisabled()) return;

    // Fetch merchant's analytics configuration and feature toggle.
    const merchantAnalytics = await fetchAnalyticsPlatformConfig(
      supabase,
      merchantId
    );

    if (!merchantAnalytics) {
      logger.warn({
        message: 'Failed to fetch analytics config for conversion tracking',
        merchantId,
      });
      return;
    }

    // Check if merchant has explicitly disabled offline conversions
    if (merchantAnalytics?.offline_conversions_enabled === false) {
      logger.info({
        message: 'Offline conversions disabled by merchant',
        merchantId,
        orderId: order.id,
      });
      return;
    }

    const analyticsConfig: MerchantAnalyticsConfig = {
      facebook_pixel_id: merchantAnalytics.facebook_pixel_id,
      facebook_capi_token: merchantAnalytics.facebook_capi_token,
      tiktok_pixel_id: merchantAnalytics.tiktok_pixel_id,
      tiktok_access_token: merchantAnalytics.tiktok_access_token,
      google_analytics_id: merchantAnalytics.google_analytics_id,
      ga4_api_secret: merchantAnalytics.ga4_api_secret,
      snapchat_pixel_id: merchantAnalytics.snapchat_pixel_id,
      snapchat_capi_token: merchantAnalytics.snapchat_capi_token,
    };

    // Check if any platform is configured
    if (!hasConfiguredAnalyticsPlatform(merchantAnalytics)) {
      logger.info({
        message: 'No analytics platforms configured for merchant',
        merchantId,
        orderId: order.id,
      });
      return;
    }

    // Extract ad tracking data (cookies captured at checkout)
    const adTracking = order.ad_tracking;

    // Build conversion data with proper type handling
    const orderTotal =
      typeof order.total === 'string'
        ? Number.parseFloat(order.total)
        : order.total;

    const currency = await resolveConversionCurrency(
      supabase,
      merchantId,
      order
    );

    const orderConversionData: OrderConversionData = {
      orderId: order.id,
      orderNumber,
      total: orderTotal || 0,
      currency,
      customerEmail: order.customer_email ?? undefined,
      customerPhone: order.customer_phone ?? undefined,
      customerName: order.customer_name ?? undefined,
      customerId: order.customer_id ?? undefined,
      customerCity: order.shipping_address?.city,
      customerState: order.shipping_address?.state,
      customerZip:
        order.shipping_address?.zip || order.shipping_address?.postal_code,
      customerCountry: order.shipping_address?.country,
      items: toConversionOrderItems({
        failOnInvalidItem: options.failOnInvalidItem,
        items: order.order_items,
        orderId: order.id,
      }),
      // Ad tracking IDs for attribution
      fbclid: optionalString(adTracking?.fbclid),
      fbc: optionalString(adTracking?.fbc),
      fbp: optionalString(adTracking?.fbp),
      ttp: optionalString(adTracking?.ttp),
      ttclid: optionalString(adTracking?.ttclid),
      gclid: optionalString(adTracking?.gclid),
      sccid: optionalString(adTracking?.sccid),
      gaClientId: optionalString(adTracking?.gaClientId),
      // Enhanced matching for better Event Match Quality (EMQ)
      userIp: optionalString(adTracking?.userIp),
      userAgent: optionalString(adTracking?.userAgent),
      // Event deduplication ID
      eventId: stableEventId,
      // Privacy compliance (CCPA/GDPR)
      limitedDataUse: optionalBoolean(adTracking?.limitedDataUse),
    };

    // Send conversion and log results
    const results = await sendPurchaseConversion(
      analyticsConfig,
      orderConversionData
    );
    logConversionResults(orderNumber, results);

    logger.info({
      message: 'Offline conversion tracking completed',
      orderId: order.id,
      orderNumber,
      platforms: results.filter((r) => r.success).map((r) => r.platform),
    });
  } catch (error) {
    logger.error({
      message: 'Offline conversion tracking failed',
      orderId: order.id,
      orderNumber,
      error,
    });
    // Re-throw for callers that want to handle errors
    throw error;
  }
}
