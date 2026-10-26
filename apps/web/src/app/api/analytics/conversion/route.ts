import { type NextRequest, NextResponse } from 'next/server';
import { normalizeEventType } from '@/lib/analytics/send-to-ad-platforms';
import { trustedServerAdPlatformFanout } from '@/lib/analytics/trusted-server-ad-platform-fanout';
import { conversionEventPayload } from '@/lib/events/conversion-event-payload';
import { createEventIngressClient } from '@/lib/events/event-ingress-capability';
import type { EventIngressContext } from '@/lib/events/event-ingress-context';
import {
  isEventPipelineEnqueueEnabled,
  isLegacyAnalyticsFanoutDisabled,
  isUnverifiedEventTelemetryEnabled,
} from '@/lib/events/event-pipeline-config';
import { toClientAnalyticsDomainEventName } from '@/lib/events/event-route-registry';
import { isEventTimestampWithinWindow } from '@/lib/events/event-timestamp-window';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { recordAnalyticsDomainEvent } from '@/lib/events/record-analytics-domain-event';
import { generateEventId } from '@/lib/facebook-capi';
import { logger } from '@/lib/logger';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { conversionEventRequestSchema } from '@/schemas/conversion-event';
import { resolveConversionRouteMerchantContext } from './conversion-route-merchant-context';
import { storeLegacyConversionEvent } from './store-legacy-conversion-event';

const MAX_EVENT_BYTES = 64 * 1024;

function compatiblePipelineContext(
  context: EventIngressContext,
  persistenceMerchantId: string | null,
  hasClaimedMerchant: boolean
): EventIngressContext | null {
  if (context.ok && (context.verified || isUnverifiedEventTelemetryEnabled())) {
    return context;
  }
  if (!hasClaimedMerchant && persistenceMerchantId) {
    return {
      merchantId: persistenceMerchantId,
      ok: true,
      trustLevel: 'anonymous_client',
      verified: false,
    };
  }
  return null;
}

export async function POST(request: NextRequest) {
  const bodyResult = await readBoundedJsonBody(request, MAX_EVENT_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      {
        error:
          bodyResult.reason === 'too_large'
            ? 'Event payload too large'
            : 'Invalid JSON',
      },
      { status: bodyResult.reason === 'too_large' ? 413 : 400 }
    );
  }
  const parsed = conversionEventRequestSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const input = parsed.data;
  if (!isEventTimestampWithinWindow(input.event_time)) {
    return NextResponse.json(
      { error: 'Event timestamp outside allowed window' },
      { status: 400 }
    );
  }
  const eventType = normalizeEventType(input.event_name);
  if (!eventType) {
    return NextResponse.json(
      { error: 'Unsupported event name' },
      { status: 400 }
    );
  }

  const eventId = input.event_id ?? generateEventId();
  const durableEnqueue = isEventPipelineEnqueueEnabled();
  try {
    const contextSupabase = await createServerClient();
    const merchantContext = await resolveConversionRouteMerchantContext({
      claimedMerchantId: input.merchant_id,
      request,
      supabase: contextSupabase,
    });
    const pipelineContext = durableEnqueue
      ? compatiblePipelineContext(
          merchantContext.context,
          merchantContext.persistenceMerchantId,
          Boolean(input.merchant_id)
        )
      : null;
    if (durableEnqueue && !pipelineContext?.ok) {
      const code = !merchantContext.context.ok
        ? merchantContext.context.code
        : 'Unverified merchant context';
      return NextResponse.json(
        { error: code },
        { status: code === 'merchant_context_error' ? 500 : 403 }
      );
    }
    const merchantId = pipelineContext?.ok
      ? pipelineContext.merchantId
      : merchantContext.persistenceMerchantId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant context not found' },
        { status: 403 }
      );
    }

    const eventTimestamp = new Date(input.event_time * 1_000).toISOString();
    if (pipelineContext?.ok) {
      const eventName = toClientAnalyticsDomainEventName(
        eventType,
        pipelineContext.trustLevel
      );
      const eventSupabase = await createEventIngressClient({
        eventId,
        eventName,
        eventTimestamp,
        eventType,
        kind: 'analytics',
        merchantId,
        producer: input.event_source === 'mobile_app' ? 'mobile' : 'web',
        source: input.event_source,
        trustLevel: pipelineContext.trustLevel,
      });
      try {
        await recordAnalyticsDomainEvent(eventSupabase, {
          deliveryData: conversionEventPayload.deliveryData(input, request),
          eventData: conversionEventPayload.toStoredEventData(input),
          eventName,
          eventTimestamp,
          eventType,
          externalEventId: eventId,
          merchantId,
          requestId: request.headers.get('x-request-id') ?? undefined,
          source: input.event_source,
          trustLevel: pipelineContext.trustLevel,
        });
      } catch (error) {
        if (isLegacyAnalyticsFanoutDisabled()) throw error;
        logger.warn({
          error,
          eventId,
          message: 'Durable conversion enqueue failed; using legacy fanout',
        });
        await storeLegacyConversionEvent(
          eventSupabase,
          merchantId,
          eventType,
          eventId,
          input
        );
      }
    } else {
      const eventSupabase = await createEventIngressClient({
        eventId,
        eventName: `analytics.${eventType}.legacy.v1`,
        eventTimestamp,
        eventType,
        kind: 'analytics',
        merchantId,
        producer: input.event_source === 'mobile_app' ? 'mobile' : 'web',
        source: input.event_source,
        trustLevel: 'anonymous_client',
      });
      await storeLegacyConversionEvent(
        eventSupabase,
        merchantId,
        eventType,
        eventId,
        input
      );
    }

    const verifiedMerchantId = merchantContext.verifiedMerchantId;
    const results =
      isLegacyAnalyticsFanoutDisabled() ||
      !verifiedMerchantId ||
      conversionEventPayload.targets(input).length === 0
        ? {}
        : await trustedServerAdPlatformFanout(
            createServiceClient('event-pipeline'),
            verifiedMerchantId,
            {
              custom_data: input.custom_data,
              event_id: eventId,
              event_type: eventType,
              merchant_id: verifiedMerchantId,
              source: input.event_source,
              targets: conversionEventPayload.targets(input),
              user_data: conversionEventPayload.deliveryData(input, request),
            }
          );
    logger.info({
      durableEnqueue,
      eventId,
      eventType,
      merchantId,
      message: 'Conversion event accepted',
    });
    return NextResponse.json({ event_id: eventId, results, success: true });
  } catch {
    logger.error({ message: 'Conversion endpoint internal error' });
    return NextResponse.json(
      { error: 'Internal server error', success: false },
      { status: 500 }
    );
  }
}
