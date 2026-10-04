import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
import type { PiggyvestClientConfig } from './client';
import { recordQuarantineEvent } from './event-quarantine';
import { InflowLedgerError, recordInflowCredit } from './inflow-ledger';
import { InterestLedgerError, recordInterestPayout } from './interest-ledger';
import {
  applyRestrictionCreated,
  applyRestrictionLifted,
  attributedWalletId,
  PlanWalletRestrictionError,
} from './plan-wallet-restrictions';
import {
  applyOutflowTerminal,
  outflowReferenceCandidates,
} from './transfer-outbox';
import { claimPiggyvestEvent, resolvePiggyvestEvent } from './webhook-inbox';

/**
 * Synchronous webhook processor (runs inside the intake request).
 *
 * Protocol per event, after the inbox record exists:
 * - Interest payouts, bank-transfer inflows, restriction flips, and
 *   outflow terminals are claimed (pending or failed so storage-error
 *   retries can re-win), applied idempotently, then resolved processed.
 *   Outflow shapes are unpublished, so terminals attribute by reference
 *   candidates and resolve without effect when nothing we submitted
 *   matches. All other events return 'deferred': they stay pending as
 *   backlog for future slices. The route still acks (durable receipt),
 *   but nothing is marked processed that was not processed.
 * - Poison (inconsistent interest arithmetic, non-positive inflow amount,
 *   unattributed restriction) resolves failed and acks: retries cannot fix
 *   it, so it must not burn the provider's 10 attempts.
 * - A same-identity inflow or interest conflict quarantines the
 *   observation, resolves failed, and acks: the inbox cannot see it
 *   (event-id dedupe), so the quarantine row is the only durable
 *   evidence.
 * - Storage failures resolve failed and rethrow: the route 503s, the
 *   provider redelivers, and the claim re-wins the failed row.
 * - Busy leases throw for provider retry; only completed work is acknowledged.
 */
export type ProcessPiggyvestEventOutcome = 'processed' | 'deferred';

type HandledEvent = Extract<
  PiggyvestWebhookEvent,
  {
    eventType:
      | 'interest-payout.success'
      | 'bank-transfer.inflow.success'
      | 'restriction-created.success'
      | 'restriction-lifted.success'
      | 'bank-transfer.outflow.success'
      | 'bank-transfer.outflow.failed'
      | 'wallet-transfer.outflow.success';
  }
>;

function isHandledEvent(event: PiggyvestWebhookEvent): event is HandledEvent {
  return (
    event.eventType === 'interest-payout.success' ||
    event.eventType === 'bank-transfer.inflow.success' ||
    event.eventType === 'restriction-created.success' ||
    event.eventType === 'restriction-lifted.success' ||
    event.eventType === 'bank-transfer.outflow.success' ||
    event.eventType === 'bank-transfer.outflow.failed' ||
    event.eventType === 'wallet-transfer.outflow.success'
  );
}

async function applyEvent(
  supabase: SupabaseClient,
  event: HandledEvent,
  config: PiggyvestClientConfig | null
): Promise<void> {
  if (event.eventType === 'interest-payout.success') {
    await recordInterestPayout(supabase, event);
    return;
  }
  if (event.eventType === 'bank-transfer.inflow.success') {
    await recordInflowCredit(supabase, event);
    return;
  }
  if (
    event.eventType === 'restriction-created.success' ||
    event.eventType === 'restriction-lifted.success'
  ) {
    const walletId = attributedWalletId(event);
    if (!walletId) {
      throw new PlanWalletRestrictionError(
        'RESTRICTION_UNATTRIBUTED',
        'Restriction event has no wallet attribution'
      );
    }
    // Unknown wallets fail retryable, mirroring the inflow
    // INFLOW_LEDGER_UNMAPPED path: the provider wallet may exist while its
    // piggyvest_plan_wallets mapping row is not committed yet. Resolving
    // processed here would drop the restriction and expose the wallet as
    // ready; throwing lets the provider redeliver after the mapping lands.
    if (event.eventType === 'restriction-created.success') {
      const outcome = await applyRestrictionCreated(supabase, walletId);
      if (outcome === 'unknown-wallet') {
        throw new PlanWalletRestrictionError(
          'RESTRICTION_UNMAPPED',
          'Restriction wallet has no committed plan-wallet mapping'
        );
      }
      return;
    }
    const liftedOutcome = await applyRestrictionLifted(
      supabase,
      config,
      walletId
    );
    if (liftedOutcome === 'unknown-wallet') {
      throw new PlanWalletRestrictionError(
        'RESTRICTION_UNMAPPED',
        'Restriction wallet has no committed plan-wallet mapping'
      );
    }
    return;
  }
  // Outflow eventData shapes are unpublished: attribute by reference
  // candidates, and resolve without effect when nothing we submitted
  // matches. No flip happens without positive attribution.
  const references = outflowReferenceCandidates(
    event.eventData as Record<string, unknown>
  );
  if (references.length === 0) {
    return;
  }
  await applyOutflowTerminal(supabase, {
    references,
    status:
      event.eventType === 'bank-transfer.outflow.failed'
        ? 'failed'
        : 'succeeded',
  });
}

function poisonReason(error: unknown): string | null {
  if (
    error instanceof InterestLedgerError &&
    error.code === 'INTEREST_LEDGER_INCONSISTENT'
  ) {
    return 'interest arithmetic inconsistent';
  }
  if (
    error instanceof InflowLedgerError &&
    error.code === 'INFLOW_LEDGER_INVALID'
  ) {
    return 'inflow amount invalid';
  }
  if (
    error instanceof PlanWalletRestrictionError &&
    error.code === 'RESTRICTION_UNATTRIBUTED'
  ) {
    return 'restriction unattributed';
  }
  return null;
}

function failureReason(eventType: HandledEvent['eventType']): string {
  switch (eventType) {
    case 'interest-payout.success':
      return 'interest credit failed';
    case 'bank-transfer.inflow.success':
      return 'inflow credit failed';
    case 'restriction-created.success':
    case 'restriction-lifted.success':
      return 'restriction update failed';
    default:
      return 'outflow status update failed';
  }
}

export async function processPiggyvestEvent(
  supabase: PiggyvestIntakeServiceClient,
  event: PiggyvestWebhookEvent,
  deps: { piggyvestConfig?: PiggyvestClientConfig | null } = {}
): Promise<ProcessPiggyvestEventOutcome> {
  if (!isHandledEvent(event)) {
    return 'deferred';
  }

  const claimed = await claimPiggyvestEvent(supabase, event.eventId);
  if (claimed.outcome === 'processed') {
    return 'processed';
  }
  if (claimed.outcome === 'busy') {
    throw new Error('PiggyVest event lease is busy');
  }
  if (claimed.outcome !== 'claimed') {
    throw new Error('Invalid PiggyVest claim outcome');
  }

  try {
    await applyEvent(supabase, event, deps.piggyvestConfig ?? null);
  } catch (error) {
    const poison = poisonReason(error);
    if (poison) {
      await resolvePiggyvestEvent(supabase, {
        eventId: event.eventId,
        claimToken: claimed.claimToken,
        status: 'failed',
        lastError: poison,
      });
      return 'processed';
    }
    if (
      error instanceof InflowLedgerError &&
      error.code === 'INFLOW_LEDGER_CONFLICT' &&
      error.conflict
    ) {
      // Same-identity conflicting observation: preserve it for review and
      // ack. Retries can never resolve a provider conflict, and the inbox
      // cannot see it (it dedupes by event id), so the quarantine row is
      // the only durable evidence. No receipt, no ack.
      await recordQuarantineEvent(supabase, {
        bodyDigest: error.conflict.bodyDigest,
        reason: 'conflict',
        eventId: event.eventId,
        eventType: event.eventType,
        detail: {
          provider_transaction_id: error.conflict.providerTransactionId,
          mismatched_fields: error.conflict.mismatchedFields,
        },
      });
      await resolvePiggyvestEvent(supabase, {
        eventId: event.eventId,
        claimToken: claimed.claimToken,
        status: 'failed',
        lastError: 'inflow redelivery conflicts with credited row',
      });
      return 'processed';
    }
    if (
      error instanceof InterestLedgerError &&
      error.code === 'INTEREST_LEDGER_CONFLICT' &&
      error.conflict
    ) {
      // Same rule as the inflow conflict above: preserve the conflicting
      // interest observation for review and ack. Retries can never
      // resolve a provider conflict.
      await recordQuarantineEvent(supabase, {
        bodyDigest: error.conflict.bodyDigest,
        reason: 'conflict',
        eventId: event.eventId,
        eventType: event.eventType,
        detail: {
          provider_payout_id: error.conflict.providerPayoutId,
          mismatched_fields: error.conflict.mismatchedFields,
        },
      });
      await resolvePiggyvestEvent(supabase, {
        eventId: event.eventId,
        claimToken: claimed.claimToken,
        status: 'failed',
        lastError: 'interest redelivery conflicts with credited row',
      });
      return 'processed';
    }
    await resolvePiggyvestEvent(supabase, {
      eventId: event.eventId,
      claimToken: claimed.claimToken,
      status: 'failed',
      lastError: failureReason(event.eventType),
    }).catch(() => {
      console.warn('[PiggyVest Webhook] Failed to mark event failed');
    });
    throw error;
  }

  await resolvePiggyvestEvent(supabase, {
    eventId: event.eventId,
    claimToken: claimed.claimToken,
    status: 'processed',
  });
  return 'processed';
}
