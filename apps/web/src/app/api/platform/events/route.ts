import { type NextRequest, NextResponse } from 'next/server';
import { createEventIngressClient } from '@/lib/events/event-ingress-capability';
import { resolveEventIngressContext } from '@/lib/events/event-ingress-context';
import {
  isEventPipelineEnqueueEnabled,
  isLegacyAnalyticsFanoutDisabled,
} from '@/lib/events/event-pipeline-config';
import { toClientPlatformDomainEventName } from '@/lib/events/event-route-registry';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { recordPlatformDomainEvent } from '@/lib/events/record-platform-domain-event';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { platformEventRequestSchema } from '@/schemas/platform-event';
import { persistLegacyPlatformEvent } from './persist-legacy-platform-event';
import { forwardToPlatformAnalytics } from './platform-event-forwarding';

const MAX_EVENT_BYTES = 64 * 1024;

export async function POST(request: NextRequest) {
  try {
    const bodyResult = await readBoundedJsonBody(request, MAX_EVENT_BYTES);
    if (!bodyResult.ok && bodyResult.reason === 'too_large') {
      return NextResponse.json(
        { error: 'Event payload too large' },
        { status: 413 }
      );
    }
    if (!bodyResult.ok) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const body = bodyResult.body;
    const result = platformEventRequestSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const {
      event_type,
      event_id,
      event_data,
      merchant_id,
      session_id,
      page_url,
      referrer,
    } = result.data;
    const eventId = event_id ?? `platform_${crypto.randomUUID()}`;
    const eventTimestamp = new Date().toISOString();
    const durableEnqueue = isEventPipelineEnqueueEnabled();

    // Get request metadata
    const userAgent = request.headers.get('user-agent') || undefined;
    const ipAddress =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      undefined;

    let error: { message?: string } | null = null;
    if (durableEnqueue) {
      const context = merchant_id
        ? await resolveEventIngressContext({
            merchantId: merchant_id,
            pageUrl: page_url,
            request,
            supabase: await createServerClient(),
          })
        : {
            merchantId: '',
            ok: true as const,
            trustLevel: 'anonymous_client' as const,
            verified: false,
          };
      if (!context.ok) {
        return NextResponse.json(
          { error: context.code },
          { status: context.code === 'merchant_mismatch' ? 403 : 500 }
        );
      }

      const eventName = toClientPlatformDomainEventName(
        event_type,
        context.trustLevel
      );
      const eventSupabase = await createEventIngressClient({
        eventId,
        eventName,
        eventTimestamp,
        eventType: event_type,
        kind: 'platform',
        merchantId: context.merchantId || undefined,
        producer: 'web',
        trustLevel: context.trustLevel,
      });
      try {
        await recordPlatformDomainEvent(eventSupabase, {
          eventData: { ...(event_data ?? {}), page_url },
          deliveryData: { ip: ipAddress, ua: userAgent },
          eventName,
          eventTimestamp,
          eventType: event_type,
          externalEventId: eventId,
          merchantId: context.merchantId || undefined,
          pageUrl: page_url,
          referrer,
          requestId: request.headers.get('x-request-id') ?? undefined,
          sessionId: session_id,
          trustLevel: context.trustLevel,
        });
      } catch (enqueueError) {
        if (isLegacyAnalyticsFanoutDisabled()) {
          error = {
            message:
              enqueueError instanceof Error
                ? enqueueError.message
                : 'durable_platform_enqueue_failed',
          };
        } else {
          const fallback = await persistLegacyPlatformEvent(eventSupabase, {
            eventData: event_data,
            eventId,
            eventTimestamp,
            eventType: event_type,
            ipAddress,
            merchantId: merchant_id,
            pageUrl: page_url,
            referrer,
            sessionId: session_id,
            userAgent,
          });
          error = fallback.error;
        }
      }
    } else {
      const eventSupabase = await createEventIngressClient({
        eventId,
        eventName: `platform.${event_type}.legacy.v1`,
        eventTimestamp,
        eventType: event_type,
        kind: 'platform',
        merchantId: merchant_id,
        producer: 'web',
        trustLevel: 'anonymous_client',
      });
      const result = await persistLegacyPlatformEvent(eventSupabase, {
        eventData: event_data,
        eventId,
        eventTimestamp,
        eventType: event_type,
        ipAddress,
        merchantId: merchant_id,
        pageUrl: page_url,
        referrer,
        sessionId: session_id,
        userAgent,
      });
      error = result.error;
    }

    if (error) {
      console.error('Failed to insert platform event:', error);
      return NextResponse.json(
        { error: 'Failed to track event' },
        { status: 500 }
      );
    }

    // Also forward to platform's external analytics if configured
    // This runs in background, doesn't block response
    if (!isLegacyAnalyticsFanoutDisabled()) {
      forwardToPlatformAnalytics({
        eventData: event_data,
        eventId,
        eventType: event_type,
        pageUrl: page_url,
        request,
      }).catch((forwardError) => {
        console.warn('Failed to forward to platform analytics:', forwardError);
      });
    }

    return NextResponse.json({ event_id: eventId, success: true });
  } catch (error) {
    console.error('Platform events error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
