import { type NextRequest, NextResponse } from 'next/server';
import { getPiggyvestApiConfig } from '@/env';
import { createPiggyvestIntakeServiceClient } from '@/lib/piggyvest/server-intake-client';
import { emitPiggyvestWebhookAlert } from '@/lib/piggyvest/webhook-alerts';
import { markCaptureProcessed } from '@/lib/piggyvest/webhook-capture';
import { isPiggyvestCaptureDrainScheduled } from '@/lib/piggyvest/webhook-capture-attestation';
import { readBoundedWebhookBody } from '@/lib/piggyvest/webhook-request';
import { admitPiggyvestDelivery } from './ingress';
import {
  isAuthorizationQuarantine,
  isKeySetIncompleteRetry,
  processVerifiedDelivery,
} from './process-delivery';

/**
 * Provider delivery contract (17 Sep 2026; durable capture, R5):
 * - At-least-once: up to 10 automatic retries, plus manual resends.
 * - Signature is hex(HMAC-SHA512(secret, raw_body)) in
 *   `x-pvb-signature`, verified over the exact wire bytes.
 * - Capture is always on. Any request that verifies under a CURRENT key is
 *   durably stored (raw bytes, headers, signature, key version, receive
 *   time) before the receiver answers 200, whatever the event type and
 *   whatever financial-processing flags are set. See ingress.ts.
 * - Processing is a separate step. When it does not complete after capture
 *   the stored row stays pending either way; who retries depends on the
 *   drain attestation (PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED, read per
 *   request, exactly 'true'):
 *   - attested: the drain retries the row, so the reply is a deferred 200;
 *   - NOT attested: the provider's own redeliveries (up to 10) are the only
 *     retry mechanism, so the reply stays 503. The redelivery finds the
 *     still-pending row and re-runs processing, which is idempotent.
 *   Fail toward retry: anything but exactly 'true' means not attested.
 *
 * Status mapping:
 * - No usable server key configuration -> 503 + alert.
 * - Invalid signature, or a key revoked at ingress -> 401 + alert.
 * - Capture write fails -> 503 + alert (the provider retries; no row).
 * - Captured but processing incomplete -> 503 until the drain is attested,
 *   200 deferred once it is (alert either way).
 * - Captured, but the loaded key families cannot authorize the event while
 *   the key set is incomplete -> 503 + alert even when the drain is
 *   attested: the capture's recorded authority is immutable, so only the
 *   provider's redelivery (verified under the full set) can recover it.
 * - Everything else -> 200.
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

  // One intake client per request, created only once a delivery needs it
  // (a rejected request never constructs service authority).
  let intakeClient:
    | ReturnType<typeof createPiggyvestIntakeServiceClient>
    | undefined;
  const createClient = () => {
    intakeClient ??= createPiggyvestIntakeServiceClient();
    return intakeClient;
  };

  const admission = await admitPiggyvestDelivery({
    request,
    rawBody,
    createClient,
  });
  if (admission.kind === 'rejected') return admission.response;
  const { capture, signature, matchedSecret, families, incompleteKeySet } =
    admission.delivery;

  // An identical redelivery of a row already processed needs no work.
  if (
    capture.outcome === 'duplicate' &&
    capture.processingState === 'processed'
  ) {
    return NextResponse.json(
      { received: true, duplicate: true },
      { status: 200, headers: noStore }
    );
  }

  // Whatever happens below, the original request is already durable.
  let processing: Response | null = null;
  try {
    // Runs even for duplicates: if the first delivery captured the request
    // but crashed before the ledger write, the redelivery must still
    // credit. The inbox claim and ledger dedupe keys make that safe.
    processing = await processVerifiedDelivery(
      { rawBody, signature, matchedSecret, families, incompleteKeySet },
      { createClient, getPiggyvestConfig: getPiggyvestApiConfig }
    );
  } catch {
    processing = null;
  }
  if (processing && isKeySetIncompleteRetry(processing)) {
    // Retryable regardless of the drain attestation: replay is bounded by
    // the families recorded at admission and can never reach the handler
    // this event needs, so the provider's redelivery is the only recovery.
    emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
      captureId: capture.id,
      reason: 'key set incomplete; event not authorized by the loaded families',
    });
    return processing;
  }
  if (processing && processing.status >= 200 && processing.status < 300) {
    // A delivery quarantined for the wrong signing key family never ran a
    // financial handler: acknowledge it, but leave the capture unresolved so
    // a correctly signed redelivery of the same bytes is processed rather
    // than short-circuited as an already-processed duplicate.
    if (!isAuthorizationQuarantine(processing)) {
      await markCaptureProcessed(createClient(), capture.id);
    }
    return processing;
  }
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED', {
    captureId: capture.id,
    reason: processing
      ? `processing answered ${processing.status}; row kept for retry`
      : 'processing threw; row kept for retry',
  });
  if (isPiggyvestCaptureDrainScheduled()) {
    // The drain owns the retry; the provider can stop redelivering.
    return NextResponse.json(
      { received: true, captured: true, processing: 'deferred' },
      { status: 200, headers: noStore }
    );
  }
  // No drain yet: keep the provider's redeliveries as the retry mechanism.
  // The reply carries no failure detail.
  return NextResponse.json(
    {
      received: true,
      captured: true,
      processing: 'retry',
      code: 'PIGGYVEST_PROCESSING_RETRY',
    },
    { status: 503, headers: noStore }
  );
}
