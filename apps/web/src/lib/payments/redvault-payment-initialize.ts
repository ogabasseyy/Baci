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
  provider: RedvaultCheckoutProvider;
  redirectUrl: string;
}): Promise<RedvaultInitializationResult> {
  // A failed probe must park the checkout, never 500 it: the provider may
  // be briefly unreachable (or answer malformed) while the attempt is
  // perfectly recoverable.
  const probeSafely = async (
    reference: string
  ): Promise<RedvaultInitializationProbe> => {
    try {
      const probe = await provider.probeInitialization({ reference });
      if (
        !probe ||
        (probe.status !== 'paid' &&
          probe.status !== 'not_found' &&
          probe.status !== 'unpaid' &&
          probe.status !== 'unknown')
      ) {
        return { status: 'unknown' };
      }
      return probe;
    } catch {
      return { status: 'unknown' };
    }
  };
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

  // Runs the normal fresh path once after an ambiguous claim was voided
  // (reserve skips voided attempts). Bounded: a fresh indeterminate parks
  // for the next request instead of probing recursively.
  const initializeFreshReplacement =
    async (): Promise<RedvaultInitializationResult> => {
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
    };

  // The normal error path parks attempts here (network timeout, lost
  // response, unpersisted URL). Probing is read-only, so unlike the
  // reclaimed-lease path it needs no claim first: only the follow-up
  // void runs under the adapter, and a lost void race re-reads once.
  const reconcileIndeterminateAttempt = async (stale: {
    id: string;
    reference: string;
  }): Promise<RedvaultInitializationResult> => {
    const probe = await probeSafely(stale.reference);
    if (probe.status === 'paid' || probe.status === 'unknown') {
      // Paid: the hosted checkout settled without a persisted URL and
      // capture correlates by reference through the verify flow. Unknown:
      // the provider could not be reached. Stay parked either way.
      return { authorizationUrl: null, status: 'pending_reconciliation' };
    }
    // Not found: the POST never landed, so nothing can strand. Unpaid: a
    // hosted transaction exists but its URL is unrecoverable. Either way
    // void the ambiguous claim and run the fresh path once.
    try {
      await attemptAdapter.reconcileInitialization(stale.id, 'void');
    } catch {
      const reread = await attemptAdapter.reserve(orderId);
      if (reread.state === 'initialized' && reread.authorizationUrl) {
        return {
          authorizationUrl: reread.authorizationUrl,
          reference: reread.reference,
          status: 'initialized',
        };
      }
      return { authorizationUrl: null, status: 'pending_reconciliation' };
    }
    return initializeFreshReplacement();
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
    return reconcileIndeterminateAttempt(attempt);
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
  const probe = await probeSafely(claim.attempt.reference);
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
  // the normal fresh path once with a replacement reference.
  await attemptAdapter.reconcileInitialization(claim.attempt.id, 'void');
  return initializeFreshReplacement();
}
