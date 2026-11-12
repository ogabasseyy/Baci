import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { driveWalletRefund } from './wallet-pay-refund';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const REFUND = '6c1f3b51-2d2e-4f7c-8b62-3a4d5e6f7081';
const owed = {
  refundId: REFUND,
  operationId: OP,
  amountKobo: 100000,
  sourceWalletId: 'collection-wallet',
  destinationWalletId: 'main-wallet',
  reference: `pvb-refund-${OP}`,
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
    balance: 0,
  },
  'collection-wallet': {
    id: 'collection-wallet',
    business_id: 'business-1',
    currency: 'NGN',
    status: 'active',
    balance: 500000,
  },
};

function ports(
  overrides: Partial<Parameters<typeof driveWalletRefund>[1]> = {}
) {
  return {
    collectionWalletId: 'collection-wallet',
    readOwed: vi.fn(async () => owed as unknown),
    retrieveWallet: vi.fn(async (id: string) => wallets[id]),
    claimDispatch: vi.fn(async () => true),
    releaseAfterRejection: vi.fn(async () => true),
    lookupTransfer: vi.fn(async () => 'not_found' as const),
    transfer: vi.fn(async () => ({ accepted: true as const })),
    ...overrides,
  };
}

describe('driveWalletRefund', () => {
  it('sends the owed refund once, from the collection wallet back to the customer', async () => {
    const p = ports();
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'pending'
    );
    expect(p.claimDispatch).toHaveBeenCalledWith(REFUND);
    expect(p.transfer).toHaveBeenCalledTimes(1);
    expect(p.transfer).toHaveBeenCalledWith(owed);
  });

  it('does nothing when no refund is owed (already sent, settled or never owed)', async () => {
    const p = ports({ readOwed: vi.fn(async () => null) });
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe('none');
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('does not send when another drain already claimed the attempt', async () => {
    const p = ports({ claimDispatch: vi.fn(async () => false) });
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'pending'
    );
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('waits (and sends nothing) when the collection wallet cannot cover the refund', async () => {
    const swept = {
      ...(wallets['collection-wallet'] as object),
      balance: 99999,
    };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'collection-wallet' ? swept : wallets[id]
      ),
    });
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'unfunded'
    );
    expect(p.claimDispatch).not.toHaveBeenCalled();
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('refuses a destination that is not this customer’s main wallet', async () => {
    const foreign = {
      ...(wallets['main-wallet'] as object),
      api_customer_id: 'customer-2',
    };
    const p = ports({
      retrieveWallet: vi.fn(async (id: string) =>
        id === 'main-wallet' ? foreign : wallets[id]
      ),
    });
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'unavailable'
    );
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('refuses a source that is not the configured collection wallet', async () => {
    const p = ports({ collectionWalletId: 'other-collection' });
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'unavailable'
    );
    expect(p.transfer).not.toHaveBeenCalled();
  });

  it('holds an ambiguous failure pending and releases only a proven rejection', async () => {
    const timeout = ports({
      transfer: vi.fn(async () =>
        Promise.reject(
          new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
        )
      ),
    });
    await expect(driveWalletRefund({ paymentId: OP }, timeout)).resolves.toBe(
      'pending'
    );
    expect(timeout.releaseAfterRejection).not.toHaveBeenCalled();

    const rejected = ports({
      transfer: vi.fn(async () =>
        Promise.reject(
          new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'bad', 400)
        )
      ),
    });
    await expect(driveWalletRefund({ paymentId: OP }, rejected)).resolves.toBe(
      'released'
    );
    expect(rejected.releaseAfterRejection).toHaveBeenCalledWith(REFUND);
  });

  it('throws when the owed refund belongs to another payment', async () => {
    const p = ports({
      readOwed: vi.fn(async () => ({
        ...owed,
        operationId: '00000000-0000-4000-8000-000000000001',
      })),
    });
    await expect(driveWalletRefund({ paymentId: OP }, p)).rejects.toThrow();
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
    await expect(driveWalletRefund({ paymentId: OP }, p)).resolves.toBe(
      'unavailable'
    );
    expect(p.transfer).not.toHaveBeenCalled();
  });
});
