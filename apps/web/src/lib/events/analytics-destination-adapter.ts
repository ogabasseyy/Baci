import type { DomainEventV1 } from '@baci/shared/contracts';
import {
  type AnalyticsPlatformConfig,
  fetchAnalyticsPlatformConfig,
} from '@/lib/analytics/analytics-platform-config';
import { sendConfiguredAdPlatforms } from '@/lib/analytics/send-configured-ad-platforms';
import type {
  AdPlatformTarget,
  ConversionEvent,
} from '@/lib/analytics/send-to-ad-platforms';
import { sendGA4Event } from '@/lib/ga4-measurement-protocol';
import type { ServiceRoleClient } from '@/lib/supabase/service';
import type { EventDestinationResult } from './event-destination';
import type { EventDestination } from './event-route-registry';
import { loadPaidOrderDeliveryEvent } from './paid-order-delivery-event';
import { createStableAnalyticsClientId } from './stable-analytics-client-id';

function configured(
  config: AnalyticsPlatformConfig,
  destination: Exclude<EventDestination, 'chatgpt' | 'x'>
): boolean {
  if (destination === 'facebook') {
    return Boolean(config.facebook_pixel_id && config.facebook_capi_token);
  }
  if (destination === 'tiktok') {
    return Boolean(config.tiktok_pixel_id && config.tiktok_access_token);
  }
  if (destination === 'snapchat') {
    return Boolean(config.snapchat_pixel_id && config.snapchat_capi_token);
  }
  return Boolean(config.google_analytics_id && config.ga4_api_secret);
}

function providerTarget(
  destination: Exclude<EventDestination, 'chatgpt' | 'x'>
): AdPlatformTarget {
  return destination === 'ga4' ? 'google' : destination;
}

function parseStatus(error: string | undefined): number | undefined {
  const match = error?.match(/(?:HTTP|status)\s*(\d{3})/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

function occurredAtMicros(occurredAt: string | undefined): number | undefined {
  const timestamp = occurredAt ? Date.parse(occurredAt) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > 0
    ? Math.floor(timestamp * 1_000)
    : undefined;
}

function providerErrorCode(error: string | undefined): string {
  const normalized = error?.toLowerCase() ?? '';
  if (/missing_|missing\s/.test(normalized))
    return 'invalid_destination_payload';
  if (/unmapped|unsupported/.test(normalized)) return 'unsupported_event';
  if (
    /access token|api secret|oauth|unauthori[sz]ed|credential/.test(normalized)
  ) {
    return 'invalid_destination_credentials';
  }
  return 'provider_rejected';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function contentItems(
  value: unknown
): ConversionEvent['custom_data']['contents'] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const record = asRecord(item);
    const id = stringValue(record.id) ?? stringValue(record.product_id);
    const quantity = numberValue(record.quantity);
    if (!id || !quantity || quantity <= 0) return [];
    return [
      {
        id,
        name: stringValue(record.name) ?? stringValue(record.product_name),
        price: numberValue(record.price),
        quantity,
      },
    ];
  });
}

function fallbackContentItem(
  data: Record<string, unknown>
): ConversionEvent['custom_data']['contents'] {
  const id = stringValue(data.product_id);
  if (!id) return undefined;
  return [
    {
      id,
      name: stringValue(data.product_name),
      price: numberValue(data.product_price) ?? numberValue(data.price),
      quantity: numberValue(data.quantity) ?? 1,
    },
  ];
}

function userData(
  eventData: DomainEventV1['data']
): ConversionEvent['user_data'] {
  const value = asRecord(eventData.delivery_user_data);
  return {
    ...(typeof value.marketing_consent === 'boolean'
      ? { marketing_consent: value.marketing_consent }
      : {}),
    email: stringValue(value.email),
    external_id: stringValue(value.external_id),
    fbc: stringValue(value.fbc),
    fbp: stringValue(value.fbp),
    ip: stringValue(value.ip),
    phone: stringValue(value.phone),
    sccid: stringValue(value.sccid),
    ttclid: stringValue(value.ttclid),
    ttp: stringValue(value.ttp),
    ua: stringValue(value.ua),
  };
}

function toClientConversion(event: DomainEventV1): ConversionEvent {
  if (!event.merchant_id || !event.external_event_id) {
    throw new Error('missing_immutable_data');
  }
  const eventType = stringValue(event.data.event_type);
  const data = asRecord(event.data.event_data);
  if (!eventType) throw new Error('invalid_destination_payload');

  return {
    custom_data: {
      content_name: stringValue(data.product_name),
      content_type: 'product',
      contents: contentItems(data.items) ?? fallbackContentItem(data),
      currency: stringValue(data.currency) ?? 'NGN',
      order_id: stringValue(data.order_id),
      price: numberValue(data.product_price) ?? numberValue(data.price),
      search_string:
        stringValue(data.search_term) ?? stringValue(data.search_string),
      url: stringValue(data.page_url),
      value:
        numberValue(data.total) ??
        numberValue(data.value) ??
        numberValue(data.product_price),
    },
    event_id: event.external_event_id,
    event_type: eventType,
    merchant_id: event.merchant_id,
    occurred_at: event.occurred_at,
    source: event.producer === 'mobile' ? 'mobile_app' : 'web',
    user_data: userData(event.data),
  };
}

export async function deliverAnalyticsEvent(
  supabase: ServiceRoleClient,
  event: DomainEventV1,
  destination: Exclude<EventDestination, 'chatgpt' | 'x'>,
  signal?: AbortSignal
): Promise<EventDestinationResult> {
  if (!event.merchant_id) {
    return {
      errorCode: 'missing_immutable_data',
      errorMessage: 'merchant_id is required',
      success: false,
    };
  }

  const config = await fetchAnalyticsPlatformConfig(
    supabase,
    event.merchant_id
  );
  if (!config) {
    return {
      errorCode: 'analytics_config_unavailable',
      errorMessage: 'Analytics configuration could not be loaded',
      success: false,
    };
  }
  if (
    config.offline_conversions_enabled === false ||
    !configured(config, destination)
  ) {
    return {
      providerResponseId:
        config.offline_conversions_enabled === false
          ? 'merchant_disabled'
          : 'not_configured',
      success: true,
      terminalOutcome: 'skipped',
    };
  }

  const paid = event.event_name === 'analytics.purchase.completed.v1';
  const prepared = paid
    ? await loadPaidOrderDeliveryEvent(supabase, event)
    : { conversion: toClientConversion(event), orderNumber: '' };

  if (
    (destination === 'tiktok' || destination === 'snapchat') &&
    prepared.conversion.user_data.marketing_consent !== true
  )
    return {
      success: true,
      terminalOutcome: 'skipped',
      providerResponseId: 'consent_required',
    };

  if (destination === 'ga4') {
    if (!paid || !config.google_analytics_id || !config.ga4_api_secret) {
      return {
        errorCode: 'unsupported_event',
        errorMessage: 'GA4 route supports paid purchase events only',
        success: false,
      };
    }
    const conversion = prepared.conversion;
    const result = await sendGA4Event(
      config.google_analytics_id,
      config.ga4_api_secret,
      'purchase',
      {
        clientId:
          ('gaClientId' in prepared && prepared.gaClientId) ||
          createStableAnalyticsClientId(conversion.event_id),
        userId: conversion.user_data.external_id,
      },
      {
        currency: conversion.custom_data.currency,
        items: conversion.custom_data.contents?.map((item) => ({
          item_id: item.id,
          item_name: item.name ?? item.id,
          price: item.price,
          quantity: item.quantity,
        })),
        transaction_id: prepared.orderNumber,
        value: conversion.custom_data.value,
      },
      false,
      signal,
      occurredAtMicros(conversion.occurred_at)
    );
    return result.success
      ? { success: true, terminalOutcome: 'delivered' }
      : {
          errorCode: providerErrorCode(result.error),
          errorMessage: result.error,
          httpStatus: parseStatus(result.error),
          success: false,
        };
  }

  const results = await sendConfiguredAdPlatforms(
    config,
    {
      ...prepared.conversion,
      targets: [providerTarget(destination)],
    },
    { signal }
  );
  const result = results[destination];
  if (result?.success) return { success: true, terminalOutcome: 'delivered' };
  return {
    errorCode: result
      ? providerErrorCode(result.error)
      : 'analytics_config_unavailable',
    errorMessage: result?.error ?? 'Destination adapter produced no result',
    httpStatus: result?.httpStatus ?? parseStatus(result?.error),
    success: false,
  };
}
