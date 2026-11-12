import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { submitWalletPayment } from './wallet-pay-transfer';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const reservation = {
  operationId: OP,
  purpose: 'imei_check' as const,
  purchaseRef: 'lookup-1',
  amountKobo: 100000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  reference: `pvb-pay-${OP}`,
  businessId: 'business-1',
  providerCustomerId: 'customer-1',
};
const wallets: Record<string, unknown> = {
  'main-wallet': {
    id: 'main-wallet',
    api_customer_id: 'customer-1',
    business_id: 'business-1',
    currency: 'NGN',
    status: 'active',
    balance: 250000,
  },
  'collection-wallet': {
    id: 'collection-wallet',
    business_id: 'business-1',
    currency: 'NGN',
    status: 'active',
    balance: 0,
  },
};

function ports(
  overrides: Partial<Parameters<typeof submitWalletPayment>[1]> = {}
) {
  return {
    collectionWalletId: 'collection-wallet',
    reserve: vi.fn(async () => ({ status: 'claimed' as const, reservation })),
    retrieveWallet: vi.fn(async (id: string) => wallets[id]),
    claimDispatch: vi.fn(async () => true),
    cancelBeforeDispatch: vi.fn(async () => true),
    releaseAfterRejection: vi.fn(async () => true),
    lookupTransfer: vi.fn(async () => 'not_found' as const),
    transfer: vi.fn(async () => ({ accepted: true as const })),
    ...overrides,
  };
}

describe('submitWalletPayment', () => {
  it('sends exactly one transfer of the reserved amount to the collection wallet', async () => {
    const p = ports();
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'pending',
    });
    expect(p.transfer).toHaveBeenCalledTimes(1);
    expect(p.transfer).toHaveBeenCalledWith(reservation);
    expect(p.claimDispatch).toHaveBeenCalledWith(OP);
  });

  it.each([
    ['missing', 'missing'],
    ['wrong PIN proof', 'mismatch'],
  ])('moves nothing when the PIN proof is %s', async (_label, reason) => {
    const p = ports({
      reserve: vi.fn(async () => ({ status: 'pin_refused' as const, reason })),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'pin_refused',
      reason,
    });
    expect(p.retrieveWallet).not.toHaveBeenCalled();
    expect(p.claimDispatch).not.toHaveBeenCalled();
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('never re-sends a payment that is already pending, confirmed or released', async () => {
    for (const status of [
      'pending',
      'confirmed',
      'released',
      'needs_review',
    ] as const) {
      const p = ports({ reserve: vi.fn(async () => ({ status })) });
      await expect(
        submitWalletPayment({ operationId: OP }, p)
      ).resolves.toEqual({ status });
      expect(p.transfer).not.toHaveBeenCalled();
    }
  });

  it('does not send when another holder already claimed the dispatch', async () => {
    const p = ports({ claimDispatch: vi.fn(async () => false) });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'pending',
    });
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('releases before sending when the main wallet cannot cover the amount', async () => {
    const poor = { ...(wallets['main-wallet'] as object), balance: 99999 };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'main-wallet' ? poor : wallets[id]
      ),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'insufficient',
    });
    expect(p.cancelBeforeDispatch).toHaveBeenCalledWith(OP);
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('refuses a destination that is not the configured collection wallet', async () => {
    const p = ports({ collectionWalletId: 'other-collection' });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(p.cancelBeforeDispatch).toHaveBeenCalledWith(OP);
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('refuses a collection wallet that belongs to a customer', async () => {
    const owned = {
      ...(wallets['collection-wallet'] as object),
      api_customer_id: 'someone',
    };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'collection-wallet' ? owned : wallets[id]
      ),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('refuses a source wallet of another customer', async () => {
    const foreign = {
      ...(wallets['main-wallet'] as object),
      api_customer_id: 'customer-2',
    };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'main-wallet' ? foreign : wallets[id]
      ),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('holds a timed-out transfer pending and never retries or releases it', async () => {
    const p = ports({
      transfer: vi.fn(async () => {
        throw new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout', null);
      }),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'pending',
    });
    expect(p.transfer).toHaveBeenCalledTimes(1);
    expect(p.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it('releases only a definitive rejection with no transfer under the reference', async () => {
    const rejected = new PiggyvestApiError(
      'PIGGYVEST_REQUEST_ERROR',
      'bad',
      422
    );
    const p = ports({ transfer: vi.fn(async () => Promise.reject(rejected)) });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'released',
    });
    expect(p.releaseAfterRejection).toHaveBeenCalledWith(OP);

    const found = ports({
      transfer: vi.fn(async () => Promise.reject(rejected)),
      lookupTransfer: vi.fn(async () => 'submitted' as const),
    });
    await expect(
      submitWalletPayment({ operationId: OP }, found)
    ).resolves.toEqual({
      status: 'pending',
    });
    expect(found.releaseAfterRejection).not.toHaveBeenCalled();
  });

  it('throws when the reservation does not belong to the requested operation', async () => {
    const p = ports({
      reserve: vi.fn(async () => ({
        status: 'claimed' as const,
        reservation: {
          ...reservation,
          operationId: '00000000-0000-4000-8000-000000000001',
        },
      })),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).rejects.toThrow();
    expect(p.transfer).not.toHaveBeenCalled();
  });
  it.each([
    ['main', 'is_frozen'],
    ['main', 'has_an_active_lien'],
    ['collection', 'is_frozen'],
    ['collection', 'has_an_active_lien'],
  ])('fails closed when the %s wallet reports %s', async (which, flag) => {
    const id = `${which}-wallet`;
    const blocked = { ...(wallets[id] as object), [flag]: true };
    const p = ports({
      retrieveWallet: vi.fn(async (walletId: string) =>
        walletId === id ? blocked : wallets[walletId]
      ),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'unavailable',
    });
    expect(p.transfer).not.toHaveBeenCalled();
  });
  it('accepts a collection wallet that reports api_customer_id as null', async () => {
    const settlement = {
      ...(wallets['collection-wallet'] as object),
      api_customer_id: null,
    };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'collection-wallet' ? settlement : wallets[id]
      ),
    });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'pending',
    });
    expect(p.transfer).toHaveBeenCalledTimes(1);
  });
  it('releases cleanly when PiggyVest answers 403 "Outbound transfers are paused"', async () => {
    // Observed on PiggyVest staging, 2026-11-12: a paused account refuses the
    // POST with 403 before anything moves. That is a definite "no transfer".
    const paused = new PiggyvestApiError(
      'PIGGYVEST_AUTH_ERROR',
      'Outbound transfers are paused, please contact support',
      403
    );
    const p = ports({ transfer: vi.fn(async () => Promise.reject(paused)) });
    await expect(submitWalletPayment({ operationId: OP }, p)).resolves.toEqual({
      status: 'released',
    });
    expect(p.releaseAfterRejection).toHaveBeenCalledWith(OP);
  });
});
