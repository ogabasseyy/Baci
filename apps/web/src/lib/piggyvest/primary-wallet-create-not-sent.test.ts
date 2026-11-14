import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { settlePrimaryWalletCreateIfNotSent } from './primary-wallet-create-not-sent';

vi.mock('server-only', () => ({}));

const claimedScope = {
  merchantId: 'merchant',
  customerId: 'customer',
  userId: 'user',
  integrationId: 'integration',
  businessId: 'business',
  environment: 'production',
  intentId: 'intent',
  claimToken: 'claim',
} as const;

function storage() {
  return {
    recordUncertain: vi.fn(async () => undefined),
    releaseIntent: vi.fn(async () => true),
  };
}

const auth401 = new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'rejected', 401);

describe('settlePrimaryWalletCreateIfNotSent', () => {
  it('returns null for errors that do not prove nothing was sent', async () => {
    const store = storage();
    for (const error of [
      new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout'),
      new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 400),
      new Error('plain'),
    ]) {
      expect(
        await settlePrimaryWalletCreateIfNotSent({
          error,
          createReturned: false,
          reclaimed: false,
          storage: store,
          claimedScope,
        })
      ).toBeNull();
    }
    expect(store.releaseIntent).not.toHaveBeenCalled();
    expect(store.recordUncertain).not.toHaveBeenCalled();
  });

  it('returns null once createCustomer has returned, whatever the error', async () => {
    const store = storage();
    expect(
      await settlePrimaryWalletCreateIfNotSent({
        error: auth401,
        createReturned: true,
        reclaimed: false,
        storage: store,
        claimedScope,
      })
    ).toBeNull();
    expect(store.releaseIntent).not.toHaveBeenCalled();
  });

  it('releases a fresh intent and reports PROVIDER_UNAVAILABLE for a 401/403 or relay refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const error of [
      auth401,
      new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'forbidden', 403),
      new PiggyvestApiError('PIGGYVEST_RELAY_UNAVAILABLE', 'relay down'),
    ]) {
      const store = storage();
      expect(
        await settlePrimaryWalletCreateIfNotSent({
          error,
          createReturned: false,
          reclaimed: false,
          storage: store,
          claimedScope,
        })
      ).toEqual({ status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' });
      expect(store.releaseIntent).toHaveBeenCalledWith(claimedScope);
      expect(store.recordUncertain).not.toHaveBeenCalled();
    }
  });

  it('keeps a reclaimed intent reclaimable instead of releasing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = storage();
    expect(
      await settlePrimaryWalletCreateIfNotSent({
        error: auth401,
        createReturned: false,
        reclaimed: true,
        storage: store,
        claimedScope,
      })
    ).toEqual({ status: 'unavailable', code: 'PROVIDER_UNAVAILABLE' });
    expect(store.recordUncertain).toHaveBeenCalledWith(claimedScope);
    expect(store.releaseIntent).not.toHaveBeenCalled();
  });

  it('reports a missing token (auth error without status) as NOT_CONFIGURED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await settlePrimaryWalletCreateIfNotSent({
        error: new PiggyvestApiError('PIGGYVEST_AUTH_ERROR', 'no token'),
        createReturned: false,
        reclaimed: false,
        storage: storage(),
        claimedScope,
      })
    ).toEqual({ status: 'unavailable', code: 'NOT_CONFIGURED' });
  });

  it('reports STORAGE_UNAVAILABLE when release fails or storage throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const refused = storage();
    refused.releaseIntent.mockResolvedValue(false);
    const throwing = storage();
    throwing.recordUncertain.mockRejectedValue(new Error('db down'));
    expect(
      await settlePrimaryWalletCreateIfNotSent({
        error: auth401,
        createReturned: false,
        reclaimed: false,
        storage: refused,
        claimedScope,
      })
    ).toEqual({ status: 'unavailable', code: 'STORAGE_UNAVAILABLE' });
    expect(
      await settlePrimaryWalletCreateIfNotSent({
        error: auth401,
        createReturned: false,
        reclaimed: true,
        storage: throwing,
        claimedScope,
      })
    ).toEqual({ status: 'unavailable', code: 'STORAGE_UNAVAILABLE' });
  });

  it('logs only the error code and status, never the message or request data', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await settlePrimaryWalletCreateIfNotSent({
      error: new PiggyvestApiError(
        'PIGGYVEST_AUTH_ERROR',
        'secret detail',
        401
      ),
      createReturned: false,
      reclaimed: false,
      storage: storage(),
      claimedScope,
    });
    expect(log).toHaveBeenCalledWith(
      '[PiggyVest][primary-onboarding] create not sent: PIGGYVEST_AUTH_ERROR status=401'
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret detail');
  });
});
