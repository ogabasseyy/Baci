import { NextResponse } from 'next/server';
import { primaryInterestWebhookResponse } from '@/lib/piggyvest/primary-interest-webhook-response';
import { dispatchPrimaryWalletBankInboxIntake } from '@/lib/piggyvest/primary-wallet-bank-inbox-intake';
import { dispatchPrimaryCardSignedCustodyIntake } from '@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch';
import { dispatchPrimaryWalletInflow } from '@/lib/piggyvest/primary-wallet-inflow-dispatch';
import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';

const noStore = { 'Cache-Control': 'no-store' };

// Specialized primary intakes, tried before legacy processing. Each inbox
// verifies against its own key family only, so each branch is gated on
// that family: a legacy-signed delivery must keep flowing to the legacy
// processor instead of 503-looping on an invalid-signature verdict here.
// Returns a response when an intake claims the delivery, 'conflict' when
// the inflow dispatcher reports a redelivery conflict (the route owns the
// quarantine write), or null to fall through to the legacy path.
export async function dispatchPrimaryPiggyvestIntake(input: {
  rawBody: Buffer;
  signature: string | null;
  matchedSecret: string;
  event: PiggyvestWebhookEvent;
  families: readonly PiggyvestWebhookKeyFamily[];
}): Promise<Response | 'conflict' | null> {
  if (input.event.eventType === 'wallet-transfer.outflow.success') {
    if (input.families.includes('custody')) {
      const custody = await dispatchPrimaryCardSignedCustodyIntake({
        rawBody: input.rawBody,
        signature: input.signature,
      });
      if (custody.response) return custody.response;
    }
  }
  if (input.event.eventType === 'interest-payout.success') {
    if (input.families.includes('interest')) {
      const primary = await primaryInterestWebhookResponse({
        rawBody: input.rawBody,
        signature: input.signature,
      });
      if (primary) return primary;
    }
  }
  if (input.event.eventType === 'bank-transfer.inflow.success') {
    if (input.families.includes('bank')) {
      const bank = await dispatchPrimaryWalletBankInboxIntake({
        rawBody: input.rawBody,
        signature: input.signature,
      });
      if (bank.response) return bank.response;
    }
    const primary = await dispatchPrimaryWalletInflow({
      rawBody: input.rawBody,
      signature: input.signature,
      secret: input.matchedSecret,
      families: input.families,
    });
    if (primary === 'credited' || primary === 'duplicate') {
      return NextResponse.json(
        { received: true, duplicate: primary === 'duplicate' },
        { status: 200, headers: noStore }
      );
    }
    if (primary === 'conflict') {
      return 'conflict';
    }
  }
  return null;
}
