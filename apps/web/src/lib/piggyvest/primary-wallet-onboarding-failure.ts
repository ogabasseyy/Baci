import 'server-only';
import { settlePrimaryWalletCreateIfNotSent } from './primary-wallet-create-not-sent';
import { classifyPrimaryWalletCreationDecline } from './primary-wallet-creation-decline';
import type { PrimaryWalletCustomerLookup } from './primary-wallet-customer-lookup';
import type {
  PrimaryWalletIntentRef,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';

type OnboardingFailureOutcome = {
  status: 'pending' | 'rejected' | 'unavailable';
  code?: 'NOT_CONFIGURED' | 'INVALID_BVN' | 'STORAGE_UNAVAILABLE';
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
  claimedScope: PrimaryWalletIntentRef;
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
  const keepReclaimable =
    decline === 'interest_routing'
      ? hasPriorDispatchCustody
      : input.lookup?.kind === 'found' || input.identityRefreshed;
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
