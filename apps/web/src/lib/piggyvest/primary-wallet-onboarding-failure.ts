import 'server-only';
import { settlePrimaryWalletCreateIfNotSent } from './primary-wallet-create-not-sent';
import { classifyPrimaryWalletCreationDecline } from './primary-wallet-creation-decline';
import type { PrimaryWalletCustomerLookup } from './primary-wallet-customer-lookup';
import type {
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';
import { alertOwnershipReview } from './primary-wallet-onboarding-adoption';

type ClaimedScope = PrimaryWalletIntentScope & {
  intentId: string;
  claimToken: string;
};

type OnboardingFailureOutcome = {
  status: 'pending' | 'rejected' | 'unavailable' | 'conflict';
  code?:
    | 'OWNERSHIP_REVIEW_REQUIRED'
    | 'NOT_CONFIGURED'
    | 'INVALID_BVN'
    | 'STORAGE_UNAVAILABLE'
    | 'PROVIDER_UNAVAILABLE';
};

/**
 * Settles an exception thrown while creating or verifying a primary wallet,
 * preserving prior dispatch custody when a retry or refreshed-identity
 * claim may still have an in-flight provider customer creation.
 */
export async function settlePrimaryWalletCreateFailure(input: {
  error: unknown;
  createReturned: boolean;
  reclaimed: boolean;
  identityRefreshed: boolean;
  lookup: PrimaryWalletCustomerLookup | null | undefined;
  storage: PrimaryWalletOnboardingStorage;
  claimedScope: ClaimedScope;
}): Promise<OnboardingFailureOutcome> {
  const hasPriorDispatchCustody = input.reclaimed || input.identityRefreshed;
  const notSent = await settlePrimaryWalletCreateIfNotSent({
    error: input.error,
    createReturned: input.createReturned,
    reclaimed: hasPriorDispatchCustody,
    storage: input.storage,
    claimedScope: input.claimedScope,
  });
  if (notSent) return notSent;

  const decline = classifyPrimaryWalletCreationDecline(input.error);
  // A BVN decline proves only that THIS request created nothing. After an
  // identity refresh, the earlier, ambiguous dispatch under the replaced BVN
  // may still land a customer, and no lookup can prove it never will. So
  // custody is never released, and since no retry can settle it either, the
  // intent goes straight to an ownership hold with an alert: support sees it
  // and the client gets a review answer instead of polling a pending state.
  if (decline === 'bvn' && input.identityRefreshed) {
    alertOwnershipReview(
      'replacement BVN declined after identity refresh',
      input.claimedScope.intentId
    );
    try {
      if (!(await input.storage.recordOwnershipHold(input.claimedScope)))
        return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    } catch {
      return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    return { status: 'conflict', code: 'OWNERSHIP_REVIEW_REQUIRED' };
  }
  const keepReclaimable =
    decline === 'interest_routing'
      ? hasPriorDispatchCustody
      : input.lookup?.kind === 'found';
  if (decline !== null && !keepReclaimable) {
    try {
      if (!(await input.storage.releaseIntent(input.claimedScope)))
        return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    } catch {
      return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
    return decline === 'interest_routing'
      ? { status: 'unavailable', code: 'NOT_CONFIGURED' }
      : { status: 'rejected', code: 'INVALID_BVN' };
  }
  try {
    await input.storage.recordUncertain(input.claimedScope);
  } catch {
    return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  }
  return decline === 'interest_routing'
    ? { status: 'unavailable', code: 'NOT_CONFIGURED' }
    : { status: 'pending' };
}
