import { type NextRequest, NextResponse } from 'next/server';
import { createEventIngressClient } from '@/lib/events/event-ingress-capability';
import { resolveEventIngressContext } from '@/lib/events/event-ingress-context';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { recordAnalyticsDomainEvent } from '@/lib/events/record-analytics-domain-event';
import { createClient } from '@/lib/supabase/server';
import { facebookCapiEventSchema } from '@/schemas/facebook-capi-event';

const EVENT_TYPES = {
  ViewContent: 'product_view',
  AddToCart: 'add_to_cart',
  InitiateCheckout: 'begin_checkout',
} as const;

/** Public ingress only. Credential access and provider delivery belong to the worker. */
export async function POST(request: NextRequest) {
  const body = await readBoundedJsonBody(request, 64 * 1024);
  if (!body.ok) {
    return NextResponse.json(
      { error: 'Invalid event payload' },
      {
        status: body.reason === 'too_large' ? 413 : 400,
      }
    );
  }
  const parsed = facebookCapiEventSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid event payload' },
      { status: 400 }
    );
  }
  const input = parsed.data;
  if (
    input.eventSourceUrl &&
    new URL(input.eventSourceUrl).origin !== request.nextUrl.origin
  ) {
    return NextResponse.json(
      { error: 'Invalid event source' },
      { status: 400 }
    );
  }
  try {
    const supabase = await createClient();
    const context = await resolveEventIngressContext({
      merchantId: input.merchantId,
      pageUrl: input.eventSourceUrl,
      request,
      supabase,
    });
    if (!context.ok || !context.verified) {
      return NextResponse.json(
        { error: 'Storefront context could not be verified' },
        {
          status:
            !context.ok && context.code === 'merchant_context_error'
              ? 503
              : 403,
        }
      );
    }
    const eventId = input.eventId ?? `evt_${crypto.randomUUID()}`;
    const eventType = EVENT_TYPES[input.event];
    const eventName = `analytics.${eventType}.v1`;
    const eventTimestamp = new Date().toISOString();
    const ingress = createEventIngressClient({
      eventId,
      eventName,
      eventTimestamp,
      eventType,
      kind: 'analytics',
      merchantId: context.merchantId,
      producer: 'web',
      source: 'web',
      trustLevel: context.trustLevel,
    });
    await recordAnalyticsDomainEvent(ingress, {
      eventName,
      eventTimestamp,
      eventType,
      externalEventId: eventId,
      merchantId: context.merchantId,
      source: 'web',
      trustLevel: context.trustLevel,
      eventData: {
        targets: ['facebook'],
        currency: input.eventData.currency,
        value: input.eventData.value,
        items: input.eventData.products,
        page_url:
          input.eventSourceUrl ?? request.headers.get('referer') ?? undefined,
      },
      deliveryData: {
        ip:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          request.headers.get('x-real-ip') ??
          undefined,
        ua: request.headers.get('user-agent') ?? undefined,
        fbc: request.cookies.get('_fbc')?.value,
        fbp: request.cookies.get('_fbp')?.value,
      },
    });
    // Acceptance is not a provider receipt. Never claim delivery from ingress.
    return NextResponse.json(
      { queued: true, sent: false, eventId },
      { status: 202 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Event queue unavailable' },
      { status: 503 }
    );
  }
}
