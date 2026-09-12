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
  reserve(orderId: string): Promise<RedvaultReservedAttempt>;
};

export type RedvaultCheckoutProvider = {
  initialize(input: {
    amountKobo: number;
    authorizationMetadata: ReturnType<typeof createRedvaultPaystackMetadata>;
    customerEmail: string;
    orderId: string;
    redirectUrl: string;
    reference: string;
  }): Promise<{ authorizationUrl: string }>;
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

  try {
    const initialized = await provider.initialize({
      amountKobo: claim.attempt.amountKobo,
      authorizationMetadata: createRedvaultPaystackMetadata(
        claim.attempt.bankCode
      ),
      customerEmail,
      orderId,
      redirectUrl,
      reference: claim.attempt.reference,
    });
    if (!initialized.authorizationUrl) {
      throw new Error('REDVAULT provider returned no authorization URL');
    }
    const persisted = await attemptAdapter.markInitialized(
      claim.attempt.id,
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
    await attemptAdapter.markIndeterminate(claim.attempt.id);
    return { authorizationUrl: null, status: 'pending_reconciliation' };
  }
}
