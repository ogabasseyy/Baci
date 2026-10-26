import { type NextRequest, NextResponse } from 'next/server';
import { createEventIngressClient } from '@/lib/events/event-ingress-capability';
import { resolveEventIngressContext } from '@/lib/events/event-ingress-context';
import { readBoundedJsonBody } from '@/lib/events/read-bounded-json-body';
import { recordAnalyticsDomainEvent } from '@/lib/events/record-analytics-domain-event';
import { createClient } from '@/lib/supabase/server';
import { attrCaptureSchema } from '@/schemas/attr-capture';
import { socialCapiEventSchema } from '@/schemas/social-capi-event';

const EVENT_TYPES = {
  view_item: 'product_view',
  add_to_cart: 'add_to_cart',
  begin_checkout: 'begin_checkout',
} as const;

/** Source URL has already passed the trusted storefront-origin check. */
function snapchatClickId(
  request: NextRequest,
  sourceUrl?: string
): string | undefined {
  const candidates = [
    request.cookies.get('baci_sccid')?.value,
    request.cookies.get('ScCid')?.value,
  ];
  if (sourceUrl)
    for (const [key, value] of new URL(sourceUrl).searchParams)
      if (key.toLowerCase() === 'sccid') candidates.push(value);
  for (const candidate of candidates) {
    const parsed = attrCaptureSchema.safeParse({
      sccid: candidate,
      marketing_consent: 'true',
    });
    if (parsed.success && parsed.data.sccid) return parsed.data.sccid;
  }
  return undefined;
}

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
  const parsed = socialCapiEventSchema.safeParse(body.body);
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
        targets: ['snapchat'],
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
        marketing_consent: true,
        sccid: snapchatClickId(request, input.eventSourceUrl),
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
