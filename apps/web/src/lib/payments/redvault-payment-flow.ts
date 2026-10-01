import { randomUUID } from 'node:crypto';
import {
  createRedvaultPaystackMetadata,
  type RedvaultProviderCapture,
} from './redvault-payment-gate';

export type RedvaultAttempt = {
  amountKobo: number;
  currency: 'NGN';
  id: string;
  merchantId: string;
  orderId: string;
  quotePayloadHash: string;
  reference: string;
  state: 'created' | 'initialized' | 'indeterminate' | 'captured_held';
};

export interface RedvaultAttemptStore {
  findLive(
    input: Pick<RedvaultAttempt, 'merchantId' | 'orderId' | 'quotePayloadHash'>
  ): Promise<RedvaultAttempt | null>;
  mark(
    input: Pick<RedvaultAttempt, 'id'> & { state: RedvaultAttempt['state'] }
  ): Promise<void>;
  persist(input: RedvaultAttempt): Promise<RedvaultAttempt>;
}

export interface RedvaultPaystackProvider {
  initialize(input: {
    amount: number;
    currency: 'NGN';
    metadata: ReturnType<typeof createRedvaultPaystackMetadata>;
    reference: string;
  }): Promise<{ authorizationUrl: string }>;
}

export async function initializeRedvaultPayment({
  attemptStore,
  provider,
  bankCode,
  snapshot,
}: {
  attemptStore: RedvaultAttemptStore;
  bankCode: string;
  provider: RedvaultPaystackProvider;
  snapshot: Omit<RedvaultAttempt, 'id' | 'reference' | 'state'>;
}): Promise<{
  attempt: RedvaultAttempt;
  authorizationUrl: string | null;
  status: 'initialized' | 'pending_reconciliation';
}> {
  const existing = await attemptStore.findLive(snapshot);
  const attempt =
    existing ??
    (await attemptStore.persist({
      ...snapshot,
      id: randomUUID(),
      reference: `RV-${randomUUID()}`,
      state: 'created',
    }));

  if (existing || attempt.state !== 'created') {
    return {
      attempt,
      authorizationUrl: null,
      status: 'pending_reconciliation',
    };
  }

  try {
    const initialized = await provider.initialize({
      amount: attempt.amountKobo,
      currency: 'NGN',
      metadata: createRedvaultPaystackMetadata(bankCode),
      reference: attempt.reference,
    });
    await attemptStore.mark({ id: attempt.id, state: 'initialized' });
    return {
      attempt: { ...attempt, state: 'initialized' },
      authorizationUrl: initialized.authorizationUrl,
      status: 'initialized',
    };
  } catch {
    await attemptStore.mark({ id: attempt.id, state: 'indeterminate' });
    return {
      attempt: { ...attempt, state: 'indeterminate' },
      authorizationUrl: null,
      status: 'pending_reconciliation',
    };
  }
}

export async function reconcileRedvaultCapture({
  attempt,
  attemptStore,
}: {
  attempt: RedvaultAttempt;
  attemptStore: RedvaultAttemptStore;
  capture: RedvaultProviderCapture;
}): Promise<'held'> {
  await attemptStore.mark({
    id: attempt.id,
    state: 'captured_held',
  });
  return 'held';
}
