import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimPrimaryWalletOnboarding } from './primary-wallet-onboarding-claim';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  lookupPrimaryWalletCustomer: vi.fn(),
}));

vi.mock('./primary-wallet-customer-lookup', () => ({
  lookupPrimaryWalletCustomer: mocks.lookupPrimaryWalletCustomer,
}));

const scope = {
  customerId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
};

const fingerprints = {
  current: 'fp-current',
  legacy: 'fp-legacy',
};

function makeStorage() {
  return {
    claim: vi.fn(),
    refreshUnknown: vi.fn(),
    recordAccepted: vi.fn(),
    recordPending: vi.fn(),
    recordRoutingPending: vi.fn(),
    recordFailed: vi.fn(),
    recordComplete: vi.fn(),
  };
}

describe('claimPrimaryWalletOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an immediate non-conflict claim without checking the legacy fingerprint', async () => {
    const storage = makeStorage();
    storage.claim.mockResolvedValueOnce({
      status: 'claimed',
      intentId: 'intent-1',
      claimToken: 'token-1',
      reclaimed: false,
    });

    const result = await claimPrimaryWalletOnboarding({
      storage: storage as never,
      scope,
      fingerprints,
      thirdPartyIdentifier: 'cust@example.com',
      findCustomers: vi.fn(),
    });

    expect(result).toEqual({
      status: 'claimed',
      intentId: 'intent-1',
      claimToken: 'token-1',
      reclaimed: false,
    });
    expect(storage.claim).toHaveBeenCalledTimes(1);
    expect(storage.claim).toHaveBeenCalledWith({
      ...scope,
      requestFingerprint: 'fp-current',
    });
    expect(mocks.lookupPrimaryWalletCustomer).not.toHaveBeenCalled();
  });

  it('falls back to the legacy fingerprint before running provider lookup', async () => {
    const storage = makeStorage();
    storage.claim
      .mockResolvedValueOnce({
        status: 'conflict',
        code: 'OWNERSHIP_REVIEW_REQUIRED',
      })
      .mockResolvedValueOnce({
        status: 'claimed',
        intentId: 'intent-legacy',
        claimToken: 'token-legacy',
        reclaimed: true,
      });

    const result = await claimPrimaryWalletOnboarding({
      storage: storage as never,
      scope,
      fingerprints,
      thirdPartyIdentifier: 'cust@example.com',
      findCustomers: vi.fn(),
    });

    expect(result).toEqual({
      status: 'claimed',
      intentId: 'intent-legacy',
      claimToken: 'token-legacy',
      reclaimed: true,
    });
    expect(storage.claim).toHaveBeenNthCalledWith(2, {
      ...scope,
      requestFingerprint: 'fp-legacy',
    });
    expect(mocks.lookupPrimaryWalletCustomer).not.toHaveBeenCalled();
  });

  it('refreshes the intent when both fingerprints conflict and PiggyVest confirms no customer exists', async () => {
    const storage = makeStorage();
    storage.claim.mockResolvedValue({
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    mocks.lookupPrimaryWalletCustomer.mockResolvedValueOnce({ kind: 'none' });
    storage.refreshUnknown.mockResolvedValueOnce({
      status: 'claimed',
      intentId: 'intent-refreshed',
      claimToken: 'token-refreshed',
      reclaimed: false,
    });

    const findCustomers = vi.fn();
    const result = await claimPrimaryWalletOnboarding({
      storage: storage as never,
      scope,
      fingerprints,
      thirdPartyIdentifier: 'cust@example.com',
      findCustomers,
    });

    expect(result).toEqual({
      status: 'claimed',
      intentId: 'intent-refreshed',
      claimToken: 'token-refreshed',
      reclaimed: false,
    });
    expect(mocks.lookupPrimaryWalletCustomer).toHaveBeenCalledWith({
      thirdPartyIdentifier: 'cust@example.com',
      findCustomers,
    });
    expect(storage.refreshUnknown).toHaveBeenCalledWith({
      ...scope,
      requestFingerprint: 'fp-current',
    });
  });

  it('keeps the conflict when PiggyVest lookup does not definitively return none', async () => {
    const storage = makeStorage();
    const conflict = {
      status: 'conflict',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    } as const;
    storage.claim.mockResolvedValue(conflict);
    mocks.lookupPrimaryWalletCustomer.mockResolvedValueOnce({
      kind: 'found',
      customerId: 'pv-1',
    });

    const result = await claimPrimaryWalletOnboarding({
      storage: storage as never,
      scope,
      fingerprints,
      thirdPartyIdentifier: 'cust@example.com',
      findCustomers: vi.fn(),
    });

    expect(result).toEqual(conflict);
    expect(storage.refreshUnknown).not.toHaveBeenCalled();
  });
});
