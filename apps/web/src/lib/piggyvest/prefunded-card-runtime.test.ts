import { describe, expect, it, vi } from 'vitest';
import type { createPrefundedCardOperationStore } from './prefunded-card-operation-store';
import type { createPrefundedCardProvider } from './prefunded-card-provider';
import { createPrefundedCardRuntime } from './prefunded-card-runtime';

vi.mock('server-only', () => ({}));

const operationId = '10000000-0000-4000-8000-000000000001';
const request = {
  operationId,
  integrationId: operationId,
  merchantId: operationId,
  customerId: operationId,
  goalId: operationId,
  treasuryBindingId: operationId,
  savedMethodId: operationId,
  businessId: 'business',
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  destinationCustomerId: 'customer',
  collectionReference: 'collection',
  transferReference: 'transfer',
  amountKobo: 100,
  currency: 'NGN' as const,
};

function fixture() {
  const state = {
    operationId,
    collectionStatus: 'not_started',
    transferStatus: 'not_started',
    projectionStatus: 'unapplied',
    collectionFence: 0,
    transferFence: 0,
  } as const;
  const store = {
    readOperation: vi.fn().mockResolvedValue(state),
    project: vi.fn().mockResolvedValue('applied'),
    reserve: vi.fn(),
    claimCollection: vi.fn().mockResolvedValue({
      outcome: 'claimed',
      operationId,
      fence: 1,
      request,
    }),
    claimTransfer: vi.fn().mockResolvedValue({
      outcome: 'claimed',
      operationId,
      fence: 1,
      request,
    }),
    recordCollection: vi.fn().mockResolvedValue('unknown'),
    recordTransfer: vi.fn().mockResolvedValue('unknown'),
    claimReconciliation: vi.fn().mockResolvedValue({
      outcome: 'verify_only',
      operationId,
      token: operationId,
      fence: 1,
      leg: 'collection',
      request,
    }),
    completeReconciliation: vi.fn().mockResolvedValue('verified_success'),
  } satisfies ReturnType<typeof createPrefundedCardOperationStore>;
  const provider = {
    submitCollection: vi
      .fn()
      .mockResolvedValue({ outcome: 'submitted_for_verification' }),
    submitTransfer: vi
      .fn()
      .mockResolvedValue({ outcome: 'submitted_for_verification' }),
    verifyCollection: vi.fn().mockResolvedValue({
      outcome: 'verified_success',
      evidence: { fixture: true },
    }),
    verifyTransfer: vi.fn().mockResolvedValue({ outcome: 'deferred' }),
  } satisfies ReturnType<typeof createPrefundedCardProvider>;
  const run = createPrefundedCardRuntime({
    store,
    provider,
    expectedSystemId: '12345',
  });
  return { state, store, provider, run };
}

describe('prefunded runtime', () => {
  it('refuses a database identity failure before any provider call', async () => {
    const { store, provider, run } = fixture();
    store.readOperation.mockRejectedValue(new Error('database identity'));
    await expect(run(operationId)).rejects.toThrow('database identity');
    expect(provider.submitCollection).not.toHaveBeenCalled();
  });

  it('does not dispatch when the database claim loses a race', async () => {
    const { store, provider, run } = fixture();
    store.claimCollection.mockResolvedValue({
      outcome: 'stale_or_reconciliation_required',
    });
    await run(operationId);
    expect(provider.submitCollection).not.toHaveBeenCalled();
  });

  it('records a lost charge response as unknown without projecting savings', async () => {
    const { store, provider, run } = fixture();
    provider.submitCollection.mockRejectedValue(new Error('lost response'));
    await run(operationId);
    expect(store.recordCollection).toHaveBeenCalledWith(
      operationId,
      1,
      'unknown',
      null
    );
    expect(store.project).not.toHaveBeenCalled();
    expect(provider.submitTransfer).not.toHaveBeenCalled();
  });

  it('verifies rather than recharging after an unknown outcome', async () => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'unknown',
    });
    await expect(run(operationId)).resolves.toEqual({ outcome: 'pending' });
    expect(provider.submitCollection).not.toHaveBeenCalled();
    expect(store.completeReconciliation).toHaveBeenCalledWith(
      operationId,
      operationId,
      1,
      'collection',
      'verified_success',
      { fixture: true }
    );
  });

  it('sends a transfer only after durable collection success', async () => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'verified_success',
    });
    await run(operationId);
    expect(provider.submitTransfer).toHaveBeenCalledWith(request);
    expect(provider.submitCollection).not.toHaveBeenCalled();
    expect(store.project).not.toHaveBeenCalled();
  });

  it.each([
    'deferred',
    'reconciliation_required',
  ] as const)('does not finalize incomplete transfer evidence: %s', async (outcome) => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'verified_success',
      transferStatus: 'unknown',
    });
    store.claimReconciliation.mockResolvedValue({
      outcome: 'verify_only',
      operationId,
      token: operationId,
      fence: 2,
      leg: 'transfer',
      request,
    });
    provider.verifyTransfer.mockResolvedValue({ outcome });
    await run(operationId);
    expect(provider.verifyTransfer).toHaveBeenCalledWith(request);
    expect(provider.submitTransfer).not.toHaveBeenCalled();
    expect(store.completeReconciliation).not.toHaveBeenCalled();
    expect(store.project).not.toHaveBeenCalled();
  });

  it('projects only when both legs are durably verified', async () => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'verified_success',
      transferStatus: 'verified_success',
    });
    await expect(run(operationId)).resolves.toEqual({ outcome: 'applied' });
    expect(store.project).toHaveBeenCalledWith(operationId, '12345');
    expect(provider.submitCollection).not.toHaveBeenCalled();
    expect(provider.submitTransfer).not.toHaveBeenCalled();
  });

  it('does not project verified legs when a conflicting receipt requires reconciliation', async () => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'verified_success',
      transferStatus: 'verified_success',
      projectionStatus: 'reconciliation_required',
    });
    await expect(run(operationId)).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
    expect(store.project).not.toHaveBeenCalled();
    expect(provider.submitTransfer).not.toHaveBeenCalled();
  });

  it('still verifies an already sent transfer after collection reversal without crediting or resending', async () => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({
      ...state,
      collectionStatus: 'reversed',
      transferStatus: 'unknown',
      projectionStatus: 'reconciliation_required',
    });
    store.claimReconciliation.mockResolvedValue({
      outcome: 'verify_only',
      operationId,
      token: operationId,
      fence: 2,
      leg: 'transfer',
      request,
    });
    provider.verifyTransfer.mockResolvedValue({
      outcome: 'verified_success',
      evidence: { fixture: true },
    });
    await expect(run(operationId)).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
    expect(provider.verifyTransfer).toHaveBeenCalledOnce();
    expect(store.completeReconciliation).toHaveBeenCalledOnce();
    expect(provider.submitTransfer).not.toHaveBeenCalled();
    expect(store.project).not.toHaveBeenCalled();
  });

  it.each([
    'reversed',
    'action_required',
    'verified_failed',
  ] as const)('never sends funds for collection state %s', async (collectionStatus) => {
    const { state, store, provider, run } = fixture();
    store.readOperation.mockResolvedValue({ ...state, collectionStatus });
    await run(operationId);
    expect(provider.submitTransfer).not.toHaveBeenCalled();
    expect(store.project).not.toHaveBeenCalled();
  });
});
