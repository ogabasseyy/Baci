import { NextResponse } from 'next/server';
import { isPiggyvestKilled } from '@/lib/piggyvest/piggyvest-kill-switch';
import { authorizesLegacyHandling } from '@/lib/piggyvest/primary-event-owner';
import { primaryInterestWebhookResponse } from '@/lib/piggyvest/primary-interest-webhook-response';
import { dispatchPrimaryWalletBankInboxIntake } from '@/lib/piggyvest/primary-wallet-bank-inbox-intake';
import { dispatchPrimaryCardSignedCustodyIntake } from '@/lib/piggyvest/primary-wallet-card-custody-intake-dispatch';
import { dispatchPrimaryWalletInflow } from '@/lib/piggyvest/primary-wallet-inflow-dispatch';
import type { WebhookKeyScope } from '@/lib/piggyvest/webhook-key-archive';
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
//
// A verified dedicated-key delivery whose intake is disabled (rollback)
// answers retryable 503 — never null. Falling through would quarantine
// and ack the valid event, and the quarantine stores only a digest, so
// the provider would stop retrying and the deposit or payout could never
// be replayed.
// Kill-switch deferrals are tagged (side table, so the provider-facing
// Response is unchanged) so the capture drain can settle a replayed one
// without spending a processing attempt: a paused switch says nothing about
// the row, and counting it toward MAX_DRAIN_ATTEMPTS would park a captured
// deposit as needs_review.
const killSwitchDeferrals = new WeakSet<Response>();

export function isKillSwitchDeferral(response: Response): boolean {
  return killSwitchDeferrals.has(response);
}

function retryable(code: string, error: string): Response {
  return NextResponse.json(
    { received: false, code, error },
    { status: 503, headers: noStore }
  );
}

// A wallet-transfer outflow is a terminal notice for a transfer already
// submitted, which must keep reconciling. Only a custody-signed one is new
// card-custody money in, so only that is deferred.
function isMoneyInDelivery(
  eventType: string,
  families: readonly PiggyvestWebhookKeyFamily[]
): boolean {
  if (eventType === 'wallet-transfer.outflow.success')
    return families.includes('custody');
  return (
    eventType === 'bank-transfer.inflow.success' ||
    eventType === 'interest-payout.success'
  );
}

export async function dispatchPrimaryPiggyvestIntake(input: {
  rawBody: Buffer;
  signature: string | null;
  matchedSecret: string;
  event: PiggyvestWebhookEvent;
  families: readonly PiggyvestWebhookKeyFamily[];
  /**
   * `replay` for stored deliveries: each family intake then also accepts
   * its OWN family's archived keys past their overlap. A key archived for
   * one family never reaches another family's intake: the intake call is
   * gated on `families`, and each runtime only merges its own family.
   */
  keyScope?: WebhookKeyScope;
  env?: NodeJS.ProcessEnv;
}): Promise<Response | 'conflict' | null> {
  const { keyScope } = input;
  const env = input.env ?? process.env;
  // Under the master kill switch every money-in delivery is deferred, not
  // dropped: the retryable 503 makes PiggyVest redeliver, and the deposit is
  // recorded exactly once after the switch is lifted. Without this, a
  // legacy-signed delivery would fall through to the legacy credit path.
  if (
    isPiggyvestKilled(env) &&
    isMoneyInDelivery(input.event.eventType, input.families)
  ) {
    const deferred = retryable(
      'PIGGYVEST_KILL_SWITCH_ACTIVE',
      'PiggyVest intake paused; delivery will be retried'
    );
    killSwitchDeferrals.add(deferred);
    return deferred;
  }
  if (input.event.eventType === 'wallet-transfer.outflow.success') {
    if (input.families.includes('custody')) {
      const custody = await dispatchPrimaryCardSignedCustodyIntake({
        rawBody: input.rawBody,
        signature: input.signature,
        environment: env,
        keyScope,
      });
      if (custody.response) return custody.response;
      if (custody.outcome === 'disabled')
        return retryable(
          'PRIMARY_CARD_INBOX_UNAVAILABLE',
          'Primary card signed intake unavailable'
        );
    }
  }
  if (input.event.eventType === 'interest-payout.success') {
    if (input.families.includes('interest')) {
      const primary = await primaryInterestWebhookResponse({
        rawBody: input.rawBody,
        signature: input.signature,
        env,
        keyScope,
      });
      if (primary === 'disabled')
        return retryable(
          'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
          'Primary interest intake unavailable'
        );
      if (primary) return primary;
    }
  }
  if (input.event.eventType === 'bank-transfer.inflow.success') {
    let bankInboxDisabled = false;
    if (input.families.includes('bank')) {
      const bank = await dispatchPrimaryWalletBankInboxIntake({
        rawBody: input.rawBody,
        signature: input.signature,
        env,
        keyScope,
      });
      if (bank.response) return bank.response;
      bankInboxDisabled = bank.outcome === 'disabled';
    }
    const primary = await dispatchPrimaryWalletInflow({
      rawBody: input.rawBody,
      signature: input.signature,
      secret: input.matchedSecret,
      families: input.families,
      env,
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
    // The engine readiness gate refused the primary credit (not ready, or
    // the check failed) before anything was applied. A legacy-signed
    // delivery then falls through exactly as if the primary inflow were
    // switched off: the legacy ledger credits only its own verified plan
    // wallets, and a primary-owned deposit fails there retryable
    // (unmapped), so it stays captured and credits once after readiness.
    // A delivery no legacy key signed is not authorized for legacy
    // handling; it answers retryable rather than being quarantined.
    if (primary === 'prerequisite') {
      if (authorizesLegacyHandling(input.event.eventType, input.families))
        return null;
      return retryable(
        'PIGGYVEST_PRIMARY_INFLOW_NOT_READY',
        'Primary wallet inflow not ready'
      );
    }
    // Rollback order matters: the legacy inflow runs first so a
    // rollback-to-legacy still credits; 503 only when it too is
    // unavailable and the inbox already declined as disabled.
    if (bankInboxDisabled && primary === 'disabled')
      return retryable(
        'PRIMARY_BANK_INBOX_UNAVAILABLE',
        'Primary bank receipt intake unavailable'
      );
  }
  return null;
}
