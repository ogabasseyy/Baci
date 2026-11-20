import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import type { PrimaryWalletOnboardingStorage } from './primary-wallet-onboarding.types';
import { settlePrimaryWalletCreateFailure } from './primary-wallet-onboarding-failure';

function makeStorage(): PrimaryWalletOnboardingStorage {
  return {
    claim: vi.fn(),
    refreshUnknown: vi.fn(),
    recordAccepted: vi.fn(),
    recordUncertain: vi.fn().mockResolvedValue(undefined),
    recordRoutingPending: vi.fn(),
    recordReview: vi.fn(),
    recordRejected: vi.fn(),
    recordOwnershipHold: vi.fn().mockResolvedValue(true),
    releaseIntent: vi.fn().mockResolvedValue(true),
  };
}

const claimedScope = {
  merchantId: 'm-1',
  customerId: 'c-1',
  userId: 'u-1',
  integrationId: 'int-1',
  businessId: 'biz-1',
  environment: 'staging' as const,
  intentId: 'intent-1',
  claimToken: 'claim-1',
};

describe('settlePrimaryWalletCreateFailure', () => {
  it('releases fresh BVN declines and rejects as INVALID_BVN', async () => {
    const storage = makeStorage();
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: false,
      identityRefreshed: false,
      lookup: undefined,
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({ status: 'rejected', code: 'INVALID_BVN' });
    expect(storage.releaseIntent).toHaveBeenCalledWith(claimedScope);
    expect(storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('bugfix (Codex P1): holds identity-refreshed BVN declines for ownership review', async () => {
    const storage = makeStorage();
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: false,
      identityRefreshed: true,
      lookup: undefined,
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(storage.recordOwnershipHold).toHaveBeenCalledWith(claimedScope);
    expect(storage.releaseIntent).not.toHaveBeenCalled();
    expect(storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('bugfix (Codex P1): holds a refreshed BVN decline for review even after a reclaim lookup listed none', async () => {
    const storage = makeStorage();
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: true,
      identityRefreshed: true,
      lookup: { kind: 'none' },
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(storage.recordOwnershipHold).toHaveBeenCalledWith(claimedScope);
    expect(storage.releaseIntent).not.toHaveBeenCalled();
    expect(storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('holds a refreshed BVN decline for review when the reclaim lookup found our customer', async () => {
    const storage = makeStorage();
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: true,
      identityRefreshed: true,
      lookup: { kind: 'found', customerId: 'pv-cust-1' },
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(storage.recordOwnershipHold).toHaveBeenCalledWith(claimedScope);
    expect(storage.releaseIntent).not.toHaveBeenCalled();
    expect(storage.recordUncertain).not.toHaveBeenCalled();
  });

  it('returns STORAGE_UNAVAILABLE when the refreshed decline hold is not written', async () => {
    const storage = makeStorage();
    storage.recordOwnershipHold = vi.fn().mockResolvedValue(false);
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: false,
      identityRefreshed: true,
      lookup: null,
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(storage.releaseIntent).not.toHaveBeenCalled();
  });

  it('returns STORAGE_UNAVAILABLE if releaseIntent throws', async () => {
    const storage = makeStorage();
    storage.releaseIntent = vi.fn().mockRejectedValue(new Error('db down'));
    const outcome = await settlePrimaryWalletCreateFailure({
      error: new PiggyvestApiError(
        'PIGGYVEST_REQUEST_ERROR',
        'Invalid BVN',
        400,
        true
      ),
      createReturned: false,
      reclaimed: false,
      identityRefreshed: false,
      lookup: undefined,
      storage,
      claimedScope,
    });

    expect(outcome).toEqual({
      status: 'unavailable',
      code: 'STORAGE_UNAVAILABLE',
    });
  });
});
