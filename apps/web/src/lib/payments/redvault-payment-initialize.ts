import 'server-only';
import type { RedvaultReservedAttempt } from './redvault-payment-attempt-client';
import { createRedvaultPaystackMetadata } from './redvault-payment-gate';

export type RedvaultPaymentAttemptAdapter = {
  claimInitialization(attemptId: string): Promise<{
    attempt: RedvaultReservedAttempt;
    claimed: boolean;
    fresh: boolean;
  }>;
  markIndeterminate(attemptId: string): Promise<void>;
  markInitialized(
    attemptId: string,
    authorizationUrl: string
  ): Promise<RedvaultReservedAttempt>;
  reconcileInitialization(
    attemptId: string,
    state: 'indeterminate' | 'void'
  ): Promise<void>;
  reserve(orderId: string): Promise<RedvaultReservedAttempt>;
};

export type RedvaultInitializationProbe =
  | { status: 'not_found' }
  | { status: 'paid' }
  | { status: 'unpaid' }
  | { status: 'unknown' };

export type RedvaultCheckoutProvider = {
  initialize(input: {
    amountKobo: number;
    authorizationMetadata: ReturnType<typeof createRedvaultPaystackMetadata>;
    customerEmail: string;
    orderId: string;
    paystackSubaccount: string;
    platformFeeKobo: number;
    redirectUrl: string;
    reference: string;
    retainedShippingKobo: number;
  }): Promise<{ authorizationUrl: string }>;
  probeInitialization(input: {
    reference: string;
  }): Promise<RedvaultInitializationProbe>;
};

type RedvaultInitializationResult =
  | { authorizationUrl: string; reference: string; status: 'initialized' }
  | { authorizationUrl: null; status: 'pending_reconciliation' };

export async function initializeRedvaultCheckout({
  attemptAdapter,
  customerEmail,
  orderId,
  provider,
  redirectUrl,
}: {
  attemptAdapter: RedvaultPaymentAttemptAdapter;
  customerEmail: string;
  orderId: string;
  /** Retained for callers; uncertain attempts are always preserved. */
  preserveAttempts?: boolean;
  provider: RedvaultCheckoutProvider;
  redirectUrl: string;
}): Promise<RedvaultInitializationResult> {
  const initializeWithClaim = async (activeClaim: {
    attempt: RedvaultReservedAttempt;
  }): Promise<
    | { authorizationUrl: string; reference: string; status: 'initialized' }
    | { authorizationUrl: null; status: 'pending_reconciliation' }
  > => {
    try {
      const initialized = await provider.initialize({
        amountKobo: activeClaim.attempt.amountKobo,
        authorizationMetadata: createRedvaultPaystackMetadata(
          activeClaim.attempt.bankCode
        ),
        customerEmail,
        orderId,
        paystackSubaccount: activeClaim.attempt.paystackSubaccount,
        platformFeeKobo: activeClaim.attempt.platformFeeKobo,
        redirectUrl,
        reference: activeClaim.attempt.reference,
        retainedShippingKobo: activeClaim.attempt.splitRetainedShippingKobo,
      });
      if (!initialized.authorizationUrl) {
        throw new Error('REDVAULT provider returned no authorization URL');
      }
      const persisted = await attemptAdapter.markInitialized(
        activeClaim.attempt.id,
        initialized.authorizationUrl
      );
      if (persisted.state !== 'initialized' || !persisted.authorizationUrl) {
        throw new Error('REDVAULT initialization was not durably persisted');
      }
      return {
        authorizationUrl: persisted.authorizationUrl,
        reference: persisted.reference,
        status: 'initialized',
      };
    } catch {
      await attemptAdapter.markIndeterminate(activeClaim.attempt.id);
      return { authorizationUrl: null, status: 'pending_reconciliation' };
    }
  };

  const attempt = await attemptAdapter.reserve(orderId);

  if (attempt.state === 'initialized' && attempt.authorizationUrl) {
    return {
      authorizationUrl: attempt.authorizationUrl,
      reference: attempt.reference,
      status: 'initialized',
    };
  }
  if (attempt.state === 'indeterminate') {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }

  const claim = await attemptAdapter.claimInitialization(attempt.id);
  if (claim.attempt.state === 'initialized' && claim.attempt.authorizationUrl) {
    return {
      authorizationUrl: claim.attempt.authorizationUrl,
      reference: claim.attempt.reference,
      status: 'initialized',
    };
  }
  if (!claim.claimed || !claim.fresh) {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }

  // The atomic claim, not the earlier reserve snapshot, proves freshness.
  return initializeWithClaim(claim);
}
