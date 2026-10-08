import { type NextRequest, NextResponse } from 'next/server';
import z from 'zod';
import { getPiggyvestApiConfig } from '@/env';
import { redactEventDetails } from '@/lib/piggyvest/event-redaction';
import { attributedWalletId } from '@/lib/piggyvest/plan-wallet-restrictions';
import { primaryInterestWebhookResponse } from '@/lib/piggyvest/primary-interest-webhook-response';
import { dispatchPrimaryWalletBankInboxIntake } from '@/lib/piggyvest/primary-wallet-bank-inbox-intake';
import { dispatchPrimaryCardSignedCustodyIntake } from '@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch';
import { dispatchPrimaryWalletInflow } from '@/lib/piggyvest/primary-wallet-inflow-dispatch';
import { createPiggyvestIntakeServiceClient } from '@/lib/piggyvest/server-intake-client';
import { outflowReferenceCandidates } from '@/lib/piggyvest/transfer-outbox';
import {
  type RecordPiggyvestEventInput,
  recordPiggyvestEvent,
} from '@/lib/piggyvest/webhook-inbox';
import { processPiggyvestEvent } from '@/lib/piggyvest/webhook-processor';
import { readBoundedWebhookBody } from '@/lib/piggyvest/webhook-request';
import { verifyPiggyvestWebhookSecrets } from '@/lib/piggyvest/webhook-secret-union';
import {
  type PiggyvestWebhookEvent,
  piggyvestWebhookEventSchema,
} from '@/schemas/piggyvest/events';
import { quarantineAndAck } from './quarantine-and-ack';

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
 * - Authentic but unparseable/unknown/conflicting event, or a delivery
 *   signed by a key family unauthorized for legacy handling -> quarantine
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
        // The credited plan wallet is the nested destination_wallet; the
        // envelope pvb_wallet is the source accrued-interest wallet.
        // Persist exactly the attribution the ledger acts on so a
        // redelivery reusing the event id with a different destination
        // surfaces as a conflict instead of a duplicate.
        walletId: event.eventData.destination_wallet,
        reference: event.pvb_reference,
        amountKobo: event.eventData.amount,
      };
    case 'create-wallet.success':
      return { ...base, walletId: event.pvb_wallet };
    case 'restriction-created.success':
    case 'restriction-lifted.success':
      // Persist exactly the attribution the processor acts on: without it,
      // a redelivery reusing the event id with a different wallet would
      // compare null-to-null, classify as a duplicate, and flip the wrong
      // wallet instead of quarantining as a conflict.
      return { ...base, walletId: attributedWalletId(event) };
    case 'bank-transfer.outflow.success':
    case 'bank-transfer.outflow.failed':
    case 'wallet-transfer.outflow.success': {
      // Same rule for the ordered reference candidates the outflow matcher
      // consumes: any change in set or order must surface as a conflict.
      const references = outflowReferenceCandidates(event.eventData);
      return {
        ...base,
        reference: references.length > 0 ? JSON.stringify(references) : null,
      };
    }
    default:
      return base;
  }
}

const correlationSchema = z.object({
  eventId: z.string().min(1).max(200).optional(),
  eventType: z.string().min(1).max(200).optional(),
});

export async function POST(request: NextRequest): Promise<Response> {
  // Bounded read (64 KiB / 5 s) before anything else: the edge proxy only
  // rejects declared Content-Lengths over 2 MiB, so a lengthless stream must
  // not be buffered unboundedly ahead of signature validation.
  const bounded = await readBoundedWebhookBody(request);
  if (!bounded.ok) {
    if (bounded.reason === 'too_large') {
      return NextResponse.json(
        { received: false, code: 'PIGGYVEST_BODY_TOO_LARGE' },
        { status: 413, headers: noStore }
      );
    }
    if (bounded.reason === 'invalid') {
      return NextResponse.json(
        { received: false, code: 'PIGGYVEST_BODY_INVALID' },
        { status: 400, headers: noStore }
      );
    }
    return NextResponse.json(
      { received: false, code: 'PIGGYVEST_BODY_UNAVAILABLE' },
      { status: 503, headers: noStore }
    );
  }
  const rawBody: Buffer = bounded.body;
  const signature = request.headers.get('x-pvb-signature');
  const verification = verifyPiggyvestWebhookSecrets({ rawBody, signature });
  if (verification.status === 'unconfigured') {
    return NextResponse.json(
      { error: 'Integration unavailable', code: 'PIGGYVEST_NOT_READY' },
      { status: 503, headers: noStore }
    );
  }
  if (verification.status === 'invalid') {
    return NextResponse.json(
      { received: false, code: 'PIGGYVEST_INVALID_SIGNATURE' },
      { status: 200, headers: noStore }
    );
  }
  const matchedSecret = verification.secret;

  let jsonPayload: unknown;
  try {
    jsonPayload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    console.warn('[PiggyVest Webhook] Authentic delivery with invalid JSON');
    return quarantineAndAck(
      rawBody,
      'unparseable',
      {},
      null,
      createPiggyvestIntakeServiceClient
    );
  }

  const parsed = piggyvestWebhookEventSchema.safeParse(jsonPayload);
  if (!parsed.success) {
    console.warn('[PiggyVest Webhook] Authentic delivery, unknown event shape');
    const correlation = correlationSchema.safeParse(jsonPayload);
    return quarantineAndAck(
      rawBody,
      'unknown-event',
      correlation.success ? correlation.data : {},
      null,
      createPiggyvestIntakeServiceClient
    );
  }

  try {
    if (parsed.data.eventType === 'wallet-transfer.outflow.success') {
      const custody = await dispatchPrimaryCardSignedCustodyIntake({
        rawBody,
        signature,
      });
      if (custody.response) return custody.response;
    }
    if (parsed.data.eventType === 'interest-payout.success') {
      const primary = await primaryInterestWebhookResponse({
        rawBody,
        signature,
      });
      if (primary) return primary;
    }
    if (parsed.data.eventType === 'bank-transfer.inflow.success') {
      const bank = await dispatchPrimaryWalletBankInboxIntake({
        rawBody,
        signature,
      });
      if (bank.response) return bank.response;
      const primary = await dispatchPrimaryWalletInflow({
        rawBody,
        signature,
        secret: matchedSecret,
        families: verification.families,
      });
      if (primary === 'credited' || primary === 'duplicate') {
        return NextResponse.json(
          { received: true, duplicate: primary === 'duplicate' },
          { status: 200, headers: noStore }
        );
      }
      if (primary === 'conflict') {
        return quarantineAndAck(
          rawBody,
          'conflict',
          { eventId: parsed.data.eventId, eventType: parsed.data.eventType },
          redactEventDetails(parsed.data),
          createPiggyvestIntakeServiceClient
        );
      }
    }
    // Key-family binding: only the legacy secret authorizes legacy ledger
    // writes. A delivery signed solely by a primary family key that no
    // specialized intake claimed is quarantined, never legacy-processed —
    // otherwise a compromised narrow key could forge unrelated events.
    if (!verification.families.includes('legacy')) {
      return quarantineAndAck(
        rawBody,
        'key-family',
        { eventId: parsed.data.eventId, eventType: parsed.data.eventType },
        redactEventDetails(parsed.data),
        createPiggyvestIntakeServiceClient
      );
    }
    // Processing runs even for duplicates: if the first delivery recorded
    // the inbox row but crashed before the ledger write, the redelivery
    // must still credit. The claim makes concurrent attempts safe.
    const outcome = await recordPiggyvestEvent(
      createPiggyvestIntakeServiceClient(),
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
        redactEventDetails(parsed.data),
        createPiggyvestIntakeServiceClient
      );
    }
    const processing = await processPiggyvestEvent(
      createPiggyvestIntakeServiceClient(),
      parsed.data,
      {
        piggyvestConfig: getPiggyvestApiConfig(),
      }
    );
    if (processing !== 'processed') {
      // Deferred is durable backlog, not a failure: the inbox row exists,
      // nothing was marked processed, and no other processor can complete
      // these events — 503 would burn provider attempts on every retry.
      return NextResponse.json(
        { received: true, deferred: true, duplicate: outcome === 'duplicate' },
        { status: 200, headers: noStore }
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
