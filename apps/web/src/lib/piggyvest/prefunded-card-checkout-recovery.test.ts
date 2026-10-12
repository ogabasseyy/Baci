import { describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutFixture } from './prefunded-card-checkout.test-fixture';
import { createPrefundedCardCheckoutRecovery } from './prefunded-card-checkout-recovery';

vi.mock('server-only', () => ({}));

const fixture = prefundedCardCheckoutFixture();
const firstCursor = {
  createdAt: '2026-09-26T12:00:00.000Z',
  intentId: fixture.intent.intentId,
};
const nextCursor = firstCursor;

function setup() {
  const listCandidates = vi.fn().mockResolvedValue({
    candidates: [{ cursor: firstCursor, intent: fixture.intent }],
    nextCursor,
  });
  const store = {
    promoteVerifiedCollection: vi.fn().mockResolvedValue({
      intent: fixture.intent,
      phase: 'funding_pending',
      session: null,
      operationId: fixture.intent.intentId,
    }),
    flagReconciliation: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    verify: vi.fn().mockResolvedValue({
      outcome: 'verified',
      collection: fixture.collection,
    }),
  };
  return {
    listCandidates,
    provider,
    recovery: createPrefundedCardCheckoutRecovery({
      listCandidates,
      provider,
      scope: fixture.scope,
      store,
    }),
    store,
  };
}

describe('first-card checkout recovery', () => {
  it('does not report a reconciliation snapshot as a successful promotion', async () => {
    const { recovery, store } = setup();
    store.promoteVerifiedCollection.mockResolvedValueOnce({
      intent: fixture.intent,
      phase: 'reconciliation_required',
      session: null,
      operationId: null,
    });

    const result = await recovery.run({ limit: 1 });

    expect(result.promoted).toBe(0);
    expect(result.reconciliations).toBe(1);
  });

  it('rejects a promotion response for another intent', async () => {
    const { recovery, store } = setup();
    store.promoteVerifiedCollection.mockResolvedValueOnce({
      intent: { ...fixture.intent, amountKobo: fixture.intent.amountKobo + 1 },
      phase: 'funding_pending',
      session: null,
      operationId: fixture.intent.intentId,
    });

    const result = await recovery.run({ limit: 1 });

    expect(result.promoted).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('promotes an independently verified durable intent and returns its next keyset cursor', async () => {
    const { listCandidates, provider, recovery, store } = setup();

    const result = await recovery.run({ after: firstCursor, limit: 2 });

    expect(listCandidates).toHaveBeenCalledWith({
      after: firstCursor,
      limit: 2,
      scope: fixture.scope,
    });
    expect(provider.verify).toHaveBeenCalledWith(fixture.intent);
    expect(store.promoteVerifiedCollection).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection,
      fixture.collection
    );
    expect(store.flagReconciliation).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidates: 1,
      failed: 0,
      nextCursor,
      wrapped: true,
      pending: 0,
      reconciliations: 0,
      promoted: 1,
    });
  });

  it('keeps provider uncertainty retryable while advancing past the fetched page', async () => {
    const { provider, recovery, store } = setup();
    provider.verify.mockResolvedValueOnce({ outcome: 'pending' });

    const result = await recovery.run({ limit: 1 });

    expect(store.promoteVerifiedCollection).not.toHaveBeenCalled();
    expect(store.flagReconciliation).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidates: 1,
      failed: 0,
      nextCursor,
      wrapped: false,
      pending: 1,
      reconciliations: 0,
      promoted: 0,
    });
  });

  it('flags only a provider reconciliation result and sanitizes provider failures', async () => {
    const { provider, recovery, store } = setup();
    provider.verify
      .mockResolvedValueOnce({ outcome: 'reconciliation_required' })
      .mockRejectedValueOnce(new Error('provider secret must not escape'));

    const reconciled = await recovery.run({ limit: 1 });
    expect(store.flagReconciliation).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection
    );
    expect(reconciled.reconciliations).toBe(1);

    const { listCandidates } = setup();
    listCandidates.mockResolvedValueOnce({
      candidates: [{ cursor: firstCursor, intent: fixture.intent }],
      nextCursor,
    });
    const failingRecovery = createPrefundedCardCheckoutRecovery({
      listCandidates,
      provider,
      scope: fixture.scope,
      store,
    });
    const failed = await failingRecovery.run({ limit: 1 });
    expect(failed).toEqual({
      candidates: 1,
      failed: 1,
      nextCursor,
      wrapped: false,
      pending: 0,
      reconciliations: 0,
      promoted: 0,
    });
  });
});
