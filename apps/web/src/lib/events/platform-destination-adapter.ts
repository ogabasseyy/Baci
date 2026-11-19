import type { DomainEventV1 } from '@baci/shared/contracts';
import {
  type FacebookEventName,
  sendFacebookCAPIEvent,
} from '@/lib/facebook-capi';
import { sendGA4Event } from '@/lib/ga4-measurement-protocol';
import type { ServiceRoleClient } from '@/lib/supabase/service';
import type { EventDestinationResult } from './event-destination';
import type { EventDestination } from './event-route-registry';
import { createStableAnalyticsClientId } from './stable-analytics-client-id';

const GA4_NAMES: Record<string, string> = {
  'platform.landing_page_view.v1': 'page_view',
  'platform.merchant_first_sale.v1': 'purchase',
  'platform.merchant_signup_completed.v1': 'sign_up',
  'platform.merchant_signup_started.v1': 'begin_checkout',
  'platform.merchant_store_published.v1': 'generate_lead',
  'platform.platform_checkout.v1': 'begin_checkout',
  'platform.platform_purchase.v1': 'purchase',
  'platform.pricing_page_view.v1': 'page_view',
};

const FACEBOOK_NAMES: Partial<Record<string, FacebookEventName>> = {
  'platform.landing_page_view.v1': 'PageView',
  'platform.merchant_first_sale.v1': 'Purchase',
  'platform.merchant_signup_completed.v1': 'CompleteRegistration',
  'platform.merchant_signup_started.v1': 'InitiateCheckout',
  'platform.merchant_store_published.v1': 'Lead',
  'platform.platform_purchase.v1': 'Purchase',
};

type PlatformSettings = {
  facebook_capi_token: string | null;
  facebook_pixel_id: string | null;
  ga4_api_secret: string | null;
  google_analytics_id: string | null;
};

function record(value: unknown): Record<string, unknown> {
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

function failureDetails(error: string | undefined, httpStatus?: number) {
  const statusMatch = error?.match(/(?:HTTP|status)\s*(\d{3})/i);
  const normalized = error?.toLowerCase() ?? '';
  return {
    errorCode: /access token|api secret|oauth|unauthori[sz]ed|credential/.test(
      normalized
    )
      ? 'invalid_destination_credentials'
      : 'provider_rejected',
    errorMessage: error,
    httpStatus:
      httpStatus ?? (statusMatch?.[1] ? Number(statusMatch[1]) : undefined),
    success: false as const,
  };
}

export async function deliverPlatformEvent(
  supabase: ServiceRoleClient,
  event: DomainEventV1,
  destination: Exclude<EventDestination, 'chatgpt' | 'x'>,
  signal?: AbortSignal
): Promise<EventDestinationResult> {
  if (destination !== 'facebook' && destination !== 'ga4') {
    return {
      errorCode: 'unsupported_event',
      errorMessage: 'Unsupported platform destination',
      success: false,
    };
  }

  const { data, error } = await supabase
    .from('platform_settings')
    .select(
      'google_analytics_id, ga4_api_secret, facebook_pixel_id, facebook_capi_token'
    )
    .maybeSingle();
  if (error) {
    return {
      errorCode: 'analytics_config_unavailable',
      errorMessage: 'Platform analytics configuration could not be loaded',
      success: false,
    };
  }
  const settings = data as PlatformSettings | null;
  const configured =
    destination === 'facebook'
      ? settings?.facebook_pixel_id && settings.facebook_capi_token
      : settings?.google_analytics_id && settings.ga4_api_secret;
  if (!settings || !configured) {
    return {
      providerResponseId: 'not_configured',
      success: true,
      terminalOutcome: 'skipped',
    };
  }

  const eventData = record(event.data.event_data);
  const deliveryData = record(event.data.delivery_user_data);
  const value = numberValue(eventData.value);
  const currency = stringValue(eventData.currency) ?? 'NGN';
  const pageUrl = stringValue(event.data.page_url);
  const eventId = event.external_event_id ?? event.domain_event_id;

  if (destination === 'ga4') {
    const eventName = GA4_NAMES[event.event_name];
    if (!eventName) {
      return {
        errorCode: 'unsupported_event',
        errorMessage: 'Missing GA4 platform-event mapping',
        success: false,
      };
    }
    const result = await sendGA4Event(
      settings.google_analytics_id as string,
      settings.ga4_api_secret as string,
      eventName,
      {
        clientId: createStableAnalyticsClientId(eventId),
        ipAddress: stringValue(deliveryData.ip),
        userAgent: stringValue(deliveryData.ua),
      },
      {
        currency,
        event_id: eventId,
        page_location: pageUrl,
        value,
      },
      false,
      signal,
      Date.parse(event.occurred_at) * 1_000
    );
    return result.success
      ? { success: true, terminalOutcome: 'delivered' }
      : failureDetails(result.error);
  }

  const eventName = FACEBOOK_NAMES[event.event_name];
  if (!eventName) {
    return {
      errorCode: 'unsupported_event',
      errorMessage: 'Missing Facebook platform-event mapping',
      success: false,
    };
  }
  const result = await sendFacebookCAPIEvent(
    settings.facebook_pixel_id as string,
    settings.facebook_capi_token as string,
    eventName,
    {
      clientIpAddress: stringValue(deliveryData.ip),
      clientUserAgent: stringValue(deliveryData.ua),
      email: stringValue(deliveryData.email),
    },
    value === undefined ? undefined : { currency, value },
    pageUrl,
    eventId,
    undefined,
    signal,
    Math.floor(Date.parse(event.occurred_at) / 1_000)
  );
  return result.success
    ? { success: true, terminalOutcome: 'delivered' }
    : failureDetails(result.error, result.httpStatus);
}
