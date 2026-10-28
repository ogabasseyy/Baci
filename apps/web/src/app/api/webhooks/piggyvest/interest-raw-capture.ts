import { NextResponse } from 'next/server';
import { dispatchPrimaryWalletPaidInterestInbox } from '@/lib/piggyvest/primary-wallet-paid-interest-inbox-intake';
import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';

const noStore = { 'Cache-Control': 'no-store' };
const knownEventTypes = new Set<string>(
  piggyvestWebhookEventSchema.options.map(
    (option) => option.shape.eventType.value
  )
);

type RawWebhookClassification =
  | { kind: 'explicit-interest' }
  | { kind: 'known-other' }
  | { kind: 'unknown' };

function classifyRawWebhook(rawBody: Uint8Array): RawWebhookClassification {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    return { kind: 'unknown' };
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded))
    return { kind: 'unknown' };

  const eventType = 'eventType' in decoded ? decoded.eventType : undefined;
  if (eventType === 'interest-payout.success')
    return { kind: 'explicit-interest' };
  if (typeof eventType === 'string' && knownEventTypes.has(eventType))
    return { kind: 'known-other' };
  return { kind: 'unknown' };
}

function shouldCaptureBeforeSchema(
  classification: RawWebhookClassification
): boolean {
  // Explicit interest deliveries and unrecognized envelopes need raw capture
  // before strict schema parsing. Falling through on an unknown authenticated
  // payload would preserve only the legacy quarantine digest, losing exact
  // bytes needed for later classification. Known non-interest events go
  // through the normal family dispatcher and its quarantine path.
  return classification.kind !== 'known-other';
}

function warnCaptureUnavailable() {
  console.warn('[PiggyVest Webhook] PIGGYVEST_INTEREST_RECONCILIATION_PENDING');
}

function retryableCaptureFailure(): Response {
  warnCaptureUnavailable();
  return NextResponse.json(
    {
      received: false,
      code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
    },
    { status: 503, headers: noStore }
  );
}

export async function captureInterestRawDelivery(input: {
  rawBody: Uint8Array;
  signature: string | null;
  families: readonly PiggyvestWebhookKeyFamily[];
}): Promise<Response | null> {
  const classification = classifyRawWebhook(input.rawBody);
  if (!input.families.includes('interest')) {
    // A provider may use one key for both families, but it must be explicitly
    // configured for interest capture too. The legacy inbox stores redacted
    // fields, not replayable signed bytes; falling through would lose them.
    return classification.kind === 'explicit-interest'
      ? retryableCaptureFailure()
      : null;
  }
  if (!shouldCaptureBeforeSchema(classification)) return null;

  let outcome: Awaited<
    ReturnType<typeof dispatchPrimaryWalletPaidInterestInbox>
  >;
  try {
    outcome = await dispatchPrimaryWalletPaidInterestInbox({
      rawBody: input.rawBody,
      signature: input.signature,
    });
  } catch (error) {
    warnCaptureUnavailable();
    throw error;
  }
  if (outcome === 'accepted' || outcome === 'duplicate') {
    return NextResponse.json(
      {
        received: true,
        interestQueued: true,
        duplicate: outcome === 'duplicate',
      },
      { status: 200, headers: noStore }
    );
  }
  if (outcome === 'quarantined') {
    return NextResponse.json(
      { received: true, quarantined: true },
      { status: 200, headers: noStore }
    );
  }
  // Do not acknowledge an unknown signed payload unless replay-grade bytes
  // reached durable capture; the legacy quarantine stores only a digest.
  return retryableCaptureFailure();
}
