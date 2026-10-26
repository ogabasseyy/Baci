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
  | { kind: 'known-other'; eventType: string }
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
    return { kind: 'known-other', eventType };
  return { kind: 'unknown' };
}

function shouldCaptureBeforeSchema(
  classification: RawWebhookClassification,
  families: readonly PiggyvestWebhookKeyFamily[]
): boolean {
  if (classification.kind === 'explicit-interest') return true;
  if (classification.kind === 'unknown') return true;
  if (classification.kind === 'known-other') {
    if (families.includes('legacy')) return false;
    if (
      classification.eventType === 'bank-transfer.inflow.success' &&
      families.includes('bank')
    )
      return false;
    if (
      classification.eventType === 'wallet-transfer.outflow.success' &&
      families.includes('custody')
    )
      return false;
    return true;
  }
  return false;
}

function retryableCaptureFailure(): Response {
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
    return classification.kind === 'explicit-interest'
      ? retryableCaptureFailure()
      : null;
  }
  if (!shouldCaptureBeforeSchema(classification, input.families)) return null;

  const outcome = await dispatchPrimaryWalletPaidInterestInbox({
    rawBody: input.rawBody,
    signature: input.signature,
  });
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
  return retryableCaptureFailure();
}
