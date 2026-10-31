import { NextResponse } from 'next/server';
import type { PiggyvestClientConfig } from '@/lib/piggyvest/client';
import { redactEventDetails } from '@/lib/piggyvest/event-redaction';
import { recordPiggyvestEvent } from '@/lib/piggyvest/webhook-inbox';
import type { WebhookKeyScope } from '@/lib/piggyvest/webhook-key-archive';
import { processPiggyvestEvent } from '@/lib/piggyvest/webhook-processor';
import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';
import { piggyvestWebhookCorrelationSchema } from '@/schemas/piggyvest/webhook-correlation';
import { dispatchPrimaryPiggyvestIntake } from './primary-webhook-dispatch';
import { quarantineAndAck } from './quarantine-and-ack';
import { toRecordInput } from './record-input';

/**
 * Processing of a delivery whose signature has already been verified under
 * a key accepted for the family set below, and whose raw bytes are already
 * durably captured. Shared by the receiver (inline) and the capture drain
 * (replay of a stored row) so both apply identical, idempotent handling.
 *
 * Status mapping (a non-2xx result means "not completed": the caller keeps
 * the captured row for retry, it never becomes the provider-facing reply):
 * - Authentic but unparseable/unknown/conflicting event, or a delivery
 *   signed by a key family unauthorized for legacy handling -> quarantine
 *   (durable receipt of a non-retryable observation) -> 200.
 * - Completed processing -> 200 (deferred backlog included).
 * - Inbox/quarantine write fails, or a specialized intake is unavailable
 *   -> 503.
 *
 * The service-client factory and provider config are injected: the
 * event-pipeline boundary permits the API route to reach those authorities
 * directly, not through this importer.
 */

const noStore = { 'Cache-Control': 'no-store' };

export interface VerifiedDelivery {
  rawBody: Buffer;
  /** Canonical lowercase hex signature. */
  signature: string;
  matchedSecret: string;
  families: readonly PiggyvestWebhookKeyFamily[];
  /** `replay` for a stored row; the receiver's own deliveries use ingress. */
  keyScope?: WebhookKeyScope;
}

export interface ProcessDeliveryDeps {
  createClient: () => PiggyvestIntakeServiceClient;
  getPiggyvestConfig: () => PiggyvestClientConfig | null;
}

// Responses where the delivery was set aside for authorization (the wrong
// key family signed it) rather than handled. A side table keeps the
// provider-facing Response untouched: nothing internal leaks into headers.
const authorizationQuarantines = new WeakSet<Response>();

/**
 * True when `response` is the acknowledgement of a delivery that was
 * quarantined for authorization and therefore never reached a financial
 * handler. Such a capture stays unresolved so the next correctly signed
 * redelivery of the same bytes runs the handler.
 */
export function isAuthorizationQuarantine(response: Response): boolean {
  return authorizationQuarantines.has(response);
}

export async function processVerifiedDelivery(
  delivery: VerifiedDelivery,
  deps: ProcessDeliveryDeps
): Promise<Response> {
  const { rawBody, signature, matchedSecret, families, keyScope } = delivery;
  const { createClient } = deps;
  let jsonPayload: unknown;
  try {
    jsonPayload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    console.warn('[PiggyVest Webhook] Authentic delivery with invalid JSON');
    return quarantineAndAck(rawBody, 'unparseable', {}, null, createClient);
  }

  const parsed = piggyvestWebhookEventSchema.safeParse(jsonPayload);
  if (!parsed.success) {
    console.warn('[PiggyVest Webhook] Authentic delivery, unknown event shape');
    const correlation =
      piggyvestWebhookCorrelationSchema.safeParse(jsonPayload);
    return quarantineAndAck(
      rawBody,
      'unknown-event',
      correlation.success ? correlation.data : {},
      null,
      createClient
    );
  }

  try {
    // Specialized primary intakes claim their deliveries first (each gated
    // on its own key family); null falls through to legacy processing.
    const primary = await dispatchPrimaryPiggyvestIntake({
      rawBody,
      signature,
      matchedSecret,
      event: parsed.data,
      families,
      keyScope,
    });
    if (primary === 'conflict') {
      return quarantineAndAck(
        rawBody,
        'conflict',
        { eventId: parsed.data.eventId, eventType: parsed.data.eventType },
        redactEventDetails(parsed.data),
        createClient
      );
    }
    if (primary) return primary;
    // Key-family binding: only the legacy secret authorizes legacy ledger
    // writes. A delivery signed solely by a primary family key that no
    // specialized intake claimed is quarantined, never legacy-processed —
    // otherwise a compromised narrow key could forge unrelated events.
    if (!families.includes('legacy')) {
      const quarantined = await quarantineAndAck(
        rawBody,
        'key-family',
        { eventId: parsed.data.eventId, eventType: parsed.data.eventType },
        redactEventDetails(parsed.data),
        createClient
      );
      // No financial handler ran, only the signing key was wrong for it.
      // The caller must not resolve the capture as processed, or a later
      // correctly signed redelivery of the same bytes would be
      // short-circuited as a processed duplicate and never credited.
      authorizationQuarantines.add(quarantined);
      return quarantined;
    }
    // Processing runs even for duplicates: if the first delivery recorded
    // the inbox row but crashed before the ledger write, the redelivery
    // must still credit. The claim makes concurrent attempts safe.
    const outcome = await recordPiggyvestEvent(
      createClient(),
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
        createClient
      );
    }
    const processing = await processPiggyvestEvent(
      createClient(),
      parsed.data,
      {
        piggyvestConfig: deps.getPiggyvestConfig(),
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
