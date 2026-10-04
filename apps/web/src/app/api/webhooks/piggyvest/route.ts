import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import { getPiggyvestApiConfig, getPiggyvestWebhookSecret } from '@/env';
import {
  digestRawBody,
  recordQuarantineEvent,
} from '@/lib/piggyvest/event-quarantine';
import { redactEventDetails } from '@/lib/piggyvest/event-redaction';
import { verifyPiggyvestPayloadSignature } from '@/lib/piggyvest/verify-piggyvest-payload-signature';
import {
  type RecordPiggyvestEventInput,
  recordPiggyvestEvent,
} from '@/lib/piggyvest/webhook-inbox';
import { processPiggyvestEvent } from '@/lib/piggyvest/webhook-processor';
import { createServiceClient } from '@/lib/supabase/service';
import {
  type PiggyvestWebhookEvent,
  piggyvestWebhookEventSchema,
} from '@/schemas/piggyvest/events';

/**
 * Provider delivery contract (17 Sep 2026, quarantine slice 18 Sep 2026):
 * - At-least-once: up to 10 automatic retries, plus manual resends.
 *   The inbox collapses redeliveries on `event_id`.
 * - 2xx only after the event is durably recorded. A 5xx asks the
 *   provider to retry; anything else ends delivery.
 * - Signature is hex(HMAC-SHA512(secret, raw_body)) in
 *   `x-pvb-signature`, verified over the exact wire bytes.
 *
 * Status mapping:
 * - No secret configured -> 503 (fail closed; nothing is accepted).
 * - Bad/missing signature -> 200 without processing (docs behavior;
 *   forged traffic must not consume the 10 retries).
 * - Authentic but unparseable/unknown/conflicting event -> quarantine
 *   (durable receipt of a non-retryable observation) -> 200. Retries
 *   cannot fix these, so they must not burn the 10 attempts; nothing
 *   quarantined ever touches financial state.
 * - Completed processing -> 200.
 * - Inbox/quarantine write fails -> 503 so the provider retries.
 */

export function GET(): Response {
  // Reachability probe only. PiggyVest's delivery provider registers the
  // webhook URL with a GET that must return 200 — any other status means
  // registration fails and no events are ever delivered.
  return Response.json(
    { ok: true, code: 'PIGGYVEST_WEBHOOK_REACHABLE' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
}

const noStore = { 'Cache-Control': 'no-store' };

function toRecordInput(
  event: PiggyvestWebhookEvent
): RecordPiggyvestEventInput {
  const base = {
    eventId: event.eventId,
    eventType: event.eventType,
    eventCategory: event.eventCategory,
    customerId: event.customer_id,
    details: redactEventDetails(event),
  };
  switch (event.eventType) {
    case 'bank-transfer.inflow.success':
      return {
        ...base,
        walletId: event.pvb_wallet,
        reference: event.pvb_reference,
        amountKobo: event.eventData.amount,
      };
    case 'interest-payout.success':
      return {
        ...base,
        walletId: event.pvb_wallet,
        reference: event.pvb_reference,
        amountKobo: event.eventData.amount,
      };
    case 'create-wallet.success':
      return { ...base, walletId: event.pvb_wallet };
    default:
      return base;
  }
}

const correlationSchema = z.object({
  eventId: z.string().min(1).max(200).optional(),
  eventType: z.string().min(1).max(200).optional(),
});

async function quarantineAndAck(
  rawBody: Buffer,
  reason: 'unparseable' | 'unknown-event' | 'conflict',
  correlation: { eventId?: string; eventType?: string },
  detail: Record<string, unknown> | null
): Promise<Response> {
  try {
    await recordQuarantineEvent(createServiceClient(), {
      bodyDigest: digestRawBody(rawBody),
      reason,
      eventId: correlation.eventId,
      eventType: correlation.eventType,
      detail,
    });
  } catch {
    return NextResponse.json(
      { error: 'Event intake unavailable', code: 'PIGGYVEST_INBOX_ERROR' },
      { status: 503, headers: noStore }
    );
  }
  return NextResponse.json(
    { received: true, quarantined: true },
    { status: 200, headers: noStore }
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = getPiggyvestWebhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
      { status: 503, headers: noStore }
    );
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json(
      { received: false, code: 'PIGGYVEST_BODY_UNAVAILABLE' },
      { status: 503, headers: noStore }
    );
  }
  const signature = request.headers.get('x-pvb-signature');
  const authentic = verifyPiggyvestPayloadSignature({
    payload: rawBody,
    signature,
    secret,
  });
  if (!authentic) {
    return NextResponse.json(
      { received: false, code: 'PIGGYVEST_INVALID_SIGNATURE' },
      { status: 200, headers: noStore }
    );
  }

  let jsonPayload: unknown;
  try {
    jsonPayload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    console.warn('[PiggyVest Webhook] Authentic delivery with invalid JSON');
    return quarantineAndAck(rawBody, 'unparseable', {}, null);
  }

  const parsed = piggyvestWebhookEventSchema.safeParse(jsonPayload);
  if (!parsed.success) {
    console.warn('[PiggyVest Webhook] Authentic delivery, unknown event shape');
    const correlation = correlationSchema.safeParse(jsonPayload);
    return quarantineAndAck(
      rawBody,
      'unknown-event',
      correlation.success ? correlation.data : {},
      null
    );
  }

  try {
    // Processing runs even for duplicates: if the first delivery recorded
    // the inbox row but crashed before the ledger write, the redelivery
    // must still credit. The claim makes concurrent attempts safe.
    const outcome = await recordPiggyvestEvent(
      createServiceClient(),
      toRecordInput(parsed.data)
    );
    if (outcome === 'conflict') {
      console.warn(
        '[PiggyVest Webhook] Same-identity conflicting delivery quarantined'
      );
      return quarantineAndAck(
        rawBody,
        'conflict',
        { eventId: parsed.data.eventId, eventType: parsed.data.eventType },
        redactEventDetails(parsed.data)
      );
    }
    const processing = await processPiggyvestEvent(
      createServiceClient(),
      parsed.data,
      {
        piggyvestConfig: getPiggyvestApiConfig(),
      }
    );
    if (processing !== 'processed') {
      return NextResponse.json(
        { received: false, code: 'PIGGYVEST_PROCESSING_DEFERRED' },
        { status: 503, headers: noStore }
      );
    }
    return NextResponse.json(
      { received: true, duplicate: outcome === 'duplicate' },
      { status: 200, headers: noStore }
    );
  } catch {
    // Never leak storage internals; 503 asks the provider to redeliver.
    return NextResponse.json(
      { error: 'Event intake unavailable', code: 'PIGGYVEST_INBOX_ERROR' },
      { status: 503, headers: noStore }
    );
  }
}
