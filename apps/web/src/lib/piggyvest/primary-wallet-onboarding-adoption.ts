import 'server-only';
import type { PrimaryWalletCustomerLookup } from './primary-wallet-customer-lookup';
import type {
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

/**
 * What onboarding may do with the customer PiggyVest's idempotent creation
 * (returnIfExist) answered with, given the reclaim lookup (null on a fresh
 * claim, which never looks up).
 *
 * - `adopt`: proven ours: a new customer on a fresh claim or after the lookup
 *   listed none, or exactly the customer the lookup found under our
 *   identifier. Its routing is then read back before anything is recorded.
 * - `foreign`: an existing customer that is not ours (a fresh claim, or
 *   another customer than the one found). Terminal review, ids never kept.
 * - `duplicate`: the lookup found our customer, yet PiggyVest created another
 *   under our identifier. It holds a real DVA: its ids are kept for review
 *   and closure, never usable.
 * - `unproven`: an existing customer on a reclaim whose lookup listed none.
 *   returnIfExist may have matched another identity, or the listing may lag
 *   a just-created customer: never adopted, and the intent stays reclaimable
 *   so a later lookup decides.
 */
export type CreatedCustomerVerdict =
  | 'adopt'
  | 'foreign'
  | 'duplicate'
  | 'unproven';

export function judgeCreatedCustomer(input: {
  lookup: PrimaryWalletCustomerLookup | null;
  created: { customer_id: string; new_customer: boolean };
}): CreatedCustomerVerdict {
  const { lookup, created } = input;
  if (lookup === null) return created.new_customer ? 'adopt' : 'foreign';
  if (lookup.kind === 'none')
    return created.new_customer ? 'adopt' : 'unproven';
  // An uncertain or ambiguous lookup never reaches creation; never adopt.
  if (lookup.kind !== 'found') return 'foreign';
  if (created.new_customer) return 'duplicate';
  return created.customer_id === lookup.customerId ? 'adopt' : 'foreign';
}

/**
 * Keeps a created wallet's ids on its now rejected intent (routing pending,
 * then resolved unrouted) so review and DVA closure find it before any
 * customer deletion; it is never usable. If the ids cannot be kept, a plain
 * rejection still stops the intent; ids left routing pending (the resolve
 * failed) are rejected by the next recheck.
 */
export async function keepCreatedWalletForReview(input: {
  storage: PrimaryWalletOnboardingStorage;
  scope: PrimaryWalletIntentScope;
  claimedScope: PrimaryWalletIntentScope & {
    intentId: string;
    claimToken: string;
  };
  providerCustomerId: string;
  providerWalletId: string;
  interestPayoutWalletId: string;
}): Promise<void> {
  const ids = {
    providerCustomerId: input.providerCustomerId,
    providerWalletId: input.providerWalletId,
  };
  let kept = false;
  try {
    kept = await input.storage.recordRoutingPending({
      ...input.claimedScope,
      ...ids,
      interestPayoutWalletId: input.interestPayoutWalletId,
    });
    if (kept)
      await input.storage.resolveRoutingPending({
        ...input.scope,
        ...ids,
        routed: false,
      });
  } catch {
    // Kept as routing pending, or not kept: handled below or on recheck.
  }
  if (!kept) await input.storage.recordRejected(input.claimedScope);
}

export function alertOwnershipReview(reason: string, intentId: string): void {
  emitPiggyvestWebhookAlert('PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW', {
    reason,
    operationId: intentId,
  });
}
