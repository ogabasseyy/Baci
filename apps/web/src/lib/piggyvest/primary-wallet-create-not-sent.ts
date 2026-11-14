import 'server-only';
import { PiggyvestApiError } from './client';
import type {
  PrimaryWalletIntentScope,
  PrimaryWalletOnboardingStorage,
} from './primary-wallet-onboarding.types';

/**
 * True when the create-customer call provably created nothing: PiggyVest
 * rejected our API credentials (401/403) before processing the request, or
 * the egress relay refused before contacting PiggyVest. Unlike a timeout or
 * an unparseable reply, these are not ambiguous, so the onboarding attempt
 * can fail fast instead of parking the customer in an endless "pending".
 */
function isPrimaryWalletCreateNotSent(
  error: unknown
): error is PiggyvestApiError {
  return (
    error instanceof PiggyvestApiError &&
    (error.code === 'PIGGYVEST_AUTH_ERROR' ||
      error.code === 'PIGGYVEST_RELAY_UNAVAILABLE')
  );
}

type NotSentOutcome = {
  status: 'unavailable';
  code: 'STORAGE_UNAVAILABLE' | 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE';
};

/**
 * Settles an intent whose create was provably not sent. A fresh claim is
 * released for a clean retry; a reclaimed one stays reclaimable because an
 * earlier ambiguous dispatch may still have created the customer. Logs only
 * the error code and status, never request data.
 */
async function settleNotSent(input: {
  error: PiggyvestApiError;
  reclaimed: boolean;
  storage: Pick<
    PrimaryWalletOnboardingStorage,
    'recordUncertain' | 'releaseIntent'
  >;
  claimedScope: PrimaryWalletIntentScope & {
    intentId: string;
    claimToken: string;
  };
}): Promise<NotSentOutcome> {
  const { error, reclaimed, storage, claimedScope } = input;
  console.error(
    `[PiggyVest][primary-onboarding] create not sent: ${error.code} status=${error.status ?? 'none'}`
  );
  try {
    if (reclaimed) {
      await storage.recordUncertain(claimedScope);
    } else if (!(await storage.releaseIntent(claimedScope))) {
      return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
    }
  } catch {
    return { status: 'unavailable', code: 'STORAGE_UNAVAILABLE' };
  }
  // No status means our own token was missing: a configuration fault, not a
  // PiggyVest outage.
  return error.code === 'PIGGYVEST_AUTH_ERROR' && error.status === null
    ? { status: 'unavailable', code: 'NOT_CONFIGURED' }
    : { status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' };
}

/**
 * When createCustomer itself rejected with a provably-not-sent error, settles
 * the intent and returns the outcome; otherwise returns null so the caller's
 * ambiguous/decline handling runs. A later step's error never qualifies.
 */
export async function settlePrimaryWalletCreateIfNotSent(input: {
  error: unknown;
  createReturned: boolean;
  reclaimed: boolean;
  storage: Pick<
    PrimaryWalletOnboardingStorage,
    'recordUncertain' | 'releaseIntent'
  >;
  claimedScope: PrimaryWalletIntentScope & {
    intentId: string;
    claimToken: string;
  };
}): Promise<NotSentOutcome | null> {
  const { error, createReturned, ...rest } = input;
  if (createReturned || !isPrimaryWalletCreateNotSent(error)) return null;
  return await settleNotSent({ error, ...rest });
}
