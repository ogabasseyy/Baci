import 'server-only';
import type { RedvaultReservedAttempt } from './redvault-payment-attempt-client';
import { createRedvaultPaystackMetadata } from './redvault-payment-gate';

export type RedvaultPaymentAttemptAdapter = {
  claimInitialization(attemptId: string): Promise<{
    attempt: RedvaultReservedAttempt;
    claimed: boolean;
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
  }): Promise<{ authorizationUrl: string }>;
  probeInitialization(input: {
    reference: string;
  }): Promise<RedvaultInitializationProbe>;
};

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
  provider: RedvaultCheckoutProvider;
  redirectUrl: string;
}): Promise<
  | { authorizationUrl: string; reference: string; status: 'initialized' }
  | { authorizationUrl: null; status: 'pending_reconciliation' }
> {
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
  if (!claim.claimed) {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }

  if (attempt.state !== 'initializing') {
    return initializeWithClaim(claim);
  }

  // A claim on a pre-initializing attempt reclaims a stale lease: the
  // original POST may have reached Paystack before the worker died, so the
  // fixed reference is reconciled before anything is reissued. Only a
  // confirmed-missing provider transaction is safe to initialize again.
  const probe = await provider.probeInitialization({
    reference: claim.attempt.reference,
  });
  if (probe.status === 'unknown') {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }
  if (probe.status === 'paid') {
    // The hosted checkout was paid without a persisted URL. Park the
    // attempt for reconciliation: capture correlates by reference, so the
    // funds settle through the normal verify flow.
    await attemptAdapter.reconcileInitialization(
      claim.attempt.id,
      'indeterminate'
    );
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }
  if (probe.status === 'not_found') {
    return initializeWithClaim(claim);
  }

  // The provider holds an unpaid transaction for this reference, but its
  // authorization URL is unrecoverable. Void the ambiguous claim and run
  // the normal fresh path once with a replacement reference (reserve skips
  // voided attempts).
  await attemptAdapter.reconcileInitialization(claim.attempt.id, 'void');
  const fresh = await attemptAdapter.reserve(orderId);
  if (fresh.state === 'initialized' && fresh.authorizationUrl) {
    return {
      authorizationUrl: fresh.authorizationUrl,
      reference: fresh.reference,
      status: 'initialized',
    };
  }
  if (fresh.state === 'indeterminate') {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }
  const freshClaim = await attemptAdapter.claimInitialization(fresh.id);
  if (
    freshClaim.attempt.state === 'initialized' &&
    freshClaim.attempt.authorizationUrl
  ) {
    return {
      authorizationUrl: freshClaim.attempt.authorizationUrl,
      reference: freshClaim.attempt.reference,
      status: 'initialized',
    };
  }
  if (!freshClaim.claimed) {
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }
  return initializeWithClaim(freshClaim);
}
