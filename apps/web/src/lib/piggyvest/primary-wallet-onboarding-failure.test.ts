import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import type { PrimaryWalletOnboardingStorage } from './primary-wallet-onboarding.types';
import { settlePrimaryWalletCreateFailure } from './primary-wallet-onboarding-failure';

function makeStorage(): PrimaryWalletOnboardingStorage {
  return {
    claim: vi.fn(),
    recordAccepted: vi.fn(),
    recordUncertain: vi.fn().mockResolvedValue(undefined),
    markNotSent: vi.fn().mockResolvedValue(true),
    keepForReview: vi.fn(),
    releaseIntent: vi.fn().mockResolvedValue(true),
  };
}

const claimedScope = {
  merchantId: 'm-1',
  customerId: 'c-1',
  userId: 'u-1',
  integrationId: 'int-1',
  businessId: 'biz-1',
  environment: 'test' as const,
  intentId: 'intent-1',
  fenceToken: 1,
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

  it('keeps custody on identity-refreshed BVN declines', async () => {
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

    expect(outcome).toEqual({ status: 'pending' });
    expect(storage.releaseIntent).not.toHaveBeenCalled();
    expect(storage.recordUncertain).toHaveBeenCalledWith(claimedScope);
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
