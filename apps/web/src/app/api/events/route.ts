import type { SupabaseClient } from '@supabase/supabase-js';
import { after, type NextRequest, NextResponse } from 'next/server';
import {
  isConversionEvent,
  normalizeEventType,
} from '@/lib/analytics/send-to-ad-platforms';
import { trustedServerAdPlatformFanout } from '@/lib/analytics/trusted-server-ad-platform-fanout';
import { buildAnalyticsEventData } from '@/lib/events/build-analytics-event-data';
import { clientMarketingTargets } from '@/lib/events/client-marketing-targets';
import { createEventIngressClient } from '@/lib/events/event-ingress-capability';
import { resolveEventIngressContext } from '@/lib/events/event-ingress-context';
import {
  isEventPipelineEnqueueEnabled,
  isLegacyAnalyticsFanoutDisabled,
  isUnverifiedEventTelemetryEnabled,
} from '@/lib/events/event-pipeline-config';
import { toClientAnalyticsDomainEventName } from '@/lib/events/event-route-registry';
import { isEventTimestampWithinWindow } from '@/lib/events/event-timestamp-window';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { recordAnalyticsDomainEvent } from '@/lib/events/record-analytics-domain-event';
import { logger } from '@/lib/logger';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import {
  type AnalyticsEventRequest,
  analyticsEventRequestSchema,
} from '@/schemas/analytics-event';
import { buildLegacyAdPlatformFanoutEvent } from './build-legacy-ad-platform-fanout-event';
import { resolveLegacyFanoutContext } from './resolve-legacy-fanout-context';

const MAX_EVENT_BYTES = 64 * 1024;
function deliveryData(input: AnalyticsEventRequest, request: NextRequest) {
  return {
    analytics_consent: input.analytics_consent === true,
    marketing_consent: input.marketing_consent === true,
    email: input.user_data?.em,
    external_id: input.user_data?.external_id,
    fbc: input.user_data?.fbc ?? request.cookies.get('_fbc')?.value,
    fbp: input.user_data?.fbp ?? request.cookies.get('_fbp')?.value,
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      undefined,
    phone: input.user_data?.ph,
    sccid: input.user_data?.sccid ?? request.cookies.get('ScCid')?.value,
    ttclid: input.user_data?.ttclid,
    ttp: input.user_data?.ttp ?? request.cookies.get('_ttp')?.value,
    ua: request.headers.get('user-agent') ?? undefined,
  };
}
function storeLegacyEvent(
  supabase: SupabaseClient,
  input: AnalyticsEventRequest,
  eventType: string,
  eventData: Record<string, unknown>,
  eventTimestamp: string
) {
  const row = {
    event_data: eventData,
    event_timestamp: eventTimestamp,
    merchant_id: input.merchant_id,
    source: input.source ?? 'web',
    event_type: eventType,
  };
  if (input.event_id) {
    return supabase.from('analytics_events').upsert(
      { ...row, event_id: input.event_id },
      {
        ignoreDuplicates: true,
        onConflict: 'merchant_id,event_id,event_type',
      }
    );
  }
  return supabase.from('analytics_events').insert(row);
}
export async function POST(request: NextRequest) {
  const bodyResult = await readBoundedJsonBody(request, MAX_EVENT_BYTES);
  if (!bodyResult.ok && bodyResult.reason === 'too_large') {
    return NextResponse.json(
      { error: 'Event payload too large' },
      { status: 413 }
    );
  }
  if (!bodyResult.ok)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  const body = bodyResult.body;
  if (!body || typeof body !== 'object')
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const raw = body as Record<string, unknown>;
  if (!(raw.event_type || raw.event_name) || !raw.merchant_id) {
    return NextResponse.json(
      { error: 'Missing required fields: event_type and merchant_id' },
      { status: 400 }
    );
  }
  const parsed = analyticsEventRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'invalid_input', error: 'Invalid input' },
      { status: 400 }
    );
  }
  const input = parsed.data;
  if (input.timestamp && !isEventTimestampWithinWindow(input.timestamp)) {
    return NextResponse.json(
      { error: 'Event timestamp outside allowed window' },
      { status: 400 }
    );
  }
  const rawEventType = input.event_type ?? input.event_name ?? '';
  const eventType = normalizeEventType(rawEventType) ?? rawEventType;
  const eventData = buildAnalyticsEventData(input, eventType);
  const eventTimestamp = input.timestamp ?? new Date().toISOString();
  const durableEnqueue = isEventPipelineEnqueueEnabled();
  let responseEventId = input.event_id;
  let verifiedFanoutMerchantId: string | null = null;
  try {
    if (durableEnqueue) {
      const contextSupabase = await createServerClient();
      const context = await resolveEventIngressContext({
        merchantId: input.merchant_id,
        pageUrl: input.page_url ?? request.headers.get('referer') ?? undefined,
        request,
        supabase: contextSupabase,
      });
      if (!context.ok) {
        return NextResponse.json(
          { code: context.code, error: 'Failed to resolve event context' },
          { status: context.code === 'merchant_mismatch' ? 403 : 500 }
        );
      }
      if (!context.verified && !isUnverifiedEventTelemetryEnabled()) {
        return NextResponse.json(
          { error: 'Unverified merchant context' },
          { status: 403 }
        );
      }
      responseEventId = input.event_id ?? `evt_${crypto.randomUUID()}`;
      const eventSupabase = await createEventIngressClient({
        eventId: responseEventId,
        eventName: toClientAnalyticsDomainEventName(
          eventType,
          context.trustLevel
        ),
        eventTimestamp,
        eventType,
        kind: 'analytics',
        merchantId: context.merchantId,
        producer: input.source === 'mobile_app' ? 'mobile' : 'web',
        source: input.source ?? 'web',
        trustLevel: context.trustLevel,
      });
      try {
        await recordAnalyticsDomainEvent(eventSupabase, {
          deliveryData: deliveryData(input, request),
          eventData,
          eventName: toClientAnalyticsDomainEventName(
            eventType,
            context.trustLevel
          ),
          eventTimestamp,
          eventType,
          externalEventId: responseEventId,
          merchantId: context.merchantId,
          requestId: request.headers.get('x-request-id') ?? undefined,
          source: input.source ?? 'web',
          trustLevel: context.trustLevel,
        });
      } catch (error) {
        if (isLegacyAnalyticsFanoutDisabled()) throw error;
        logger.warn({
          error,
          message:
            'Durable analytics enqueue failed; preserving the event through the legacy shadow path',
        });
        const { error: legacyError } = await storeLegacyEvent(
          eventSupabase,
          { ...input, event_id: responseEventId },
          eventType,
          eventData,
          eventTimestamp
        );
        if (legacyError) throw legacyError;
      }
    } else {
      const eventSupabase = await createEventIngressClient({
        eventId: responseEventId ?? '',
        eventName: `analytics.${eventType}.legacy.v1`,
        eventTimestamp,
        eventType,
        kind: 'analytics',
        merchantId: input.merchant_id,
        producer: input.source === 'mobile_app' ? 'mobile' : 'web',
        source: input.source ?? 'web',
        trustLevel: 'anonymous_client',
      });
      const { error } = await storeLegacyEvent(
        eventSupabase,
        input,
        eventType,
        eventData,
        eventTimestamp
      );
      if (error) {
        logger.error({ error, message: 'Failed to store analytics event' });
        return NextResponse.json(
          { error: 'Failed to store event' },
          { status: 500 }
        );
      }
    }
    if (
      isConversionEvent(eventType) &&
      !isLegacyAnalyticsFanoutDisabled() &&
      clientMarketingTargets({
        analytics: input.analytics_consent,
        marketing: input.marketing_consent,
      }).length > 0
    ) {
      const contextSupabase = await createServerClient();
      verifiedFanoutMerchantId = await resolveLegacyFanoutContext({
        merchantId: input.merchant_id,
        request,
        supabase: contextSupabase,
      });
      if (verifiedFanoutMerchantId) {
        const resolvedMerchantId = verifiedFanoutMerchantId;
        const fanoutEventId =
          responseEventId ??
          `evt_${Date.now()}_${crypto.randomUUID().replace(/-/g, '')}`;
        const fanoutEvent = buildLegacyAdPlatformFanoutEvent({
          request,
          input,
          eventType,
          eventId: fanoutEventId,
          resolvedMerchantId,
        });
        after(async () => {
          if (isLegacyAnalyticsFanoutDisabled()) return;
          try {
            await trustedServerAdPlatformFanout(
              createServiceClient('event-pipeline'),
              resolvedMerchantId,
              fanoutEvent
            );
          } catch {
            logger.error({
              message: 'CAPI fan-out error after response',
            });
          }
        });
      }
    }
    return NextResponse.json({ success: true, event_id: responseEventId });
  } catch (error) {
    logger.error({ error, message: 'Event tracking error' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
