import { describe, expect, it, vi } from 'vitest';
import { verifyWalletPayProof } from './wallet-pay-proof';

vi.mock('server-only', () => ({}));

const OP = '5b0f2a40-1c1d-4e6b-9a51-2f3c4d5e6f70';
const reservation = {
  operationId: OP,
  amountKobo: 100000,
  sourceWalletId: 'main-wallet',
  destinationWalletId: 'collection-wallet',
  reference: `pvb-pay-${OP}`,
  businessId: 'business-1',
  providerCustomerId: 'customer-1',
};
function record(overrides: Record<string, unknown> = {}) {
  return {
    status: true,
    data: {
      id: 'txn-1',
      reference: 'PVB01',
      third_party_reference: `pvb-pay-${OP}`,
      internal_reference: 'txn-1',
      status: 'successful',
      amount: 100000,
      fee: 0,
      customer_id: 'business-1',
      source_wallet: 'main-wallet',
      destination_wallet: 'collection-wallet',
      ...overrides,
    },
  };
}

describe('verifyWalletPayProof', () => {
  it('verifies a successful record bound to every reserved field', () => {
    expect(verifyWalletPayProof(reservation, record())).toEqual({
      status: 'verified',
      proof: {
        operationId: OP,
        providerTransactionId: 'txn-1',
        reference: `pvb-pay-${OP}`,
        amountKobo: 100000,
        sourceWalletId: 'main-wallet',
        destinationWalletId: 'collection-wallet',
        businessId: 'business-1',
        feeKobo: 0,
      },
    });
  });

  it('reports a failed record as failed (releasable), with the same bindings', () => {
    expect(
      verifyWalletPayProof(reservation, record({ status: 'failed' })).status
    ).toBe('failed');
  });

  it('carries a non-zero fee through so the database records review', () => {
    const result = verifyWalletPayProof(reservation, record({ fee: 5000 }));
    expect(result).toMatchObject({
      status: 'verified',
      proof: { feeKobo: 5000 },
    });
  });

  it.each([
    ['amount', { amount: 99999 }],
    ['reference', { third_party_reference: 'pvb-pay-other' }],
    ['source wallet', { source_wallet: 'someone-else' }],
    ['destination wallet', { destination_wallet: 'someone-else' }],
    ['customer', { customer_id: 'customer-2' }],
    ['business', { business_id: 'business-2' }],
    ['provider id echo', { internal_reference: 'txn-2' }],
    ['pending status', { status: 'pending' }],
  ])('leaves a record with the wrong %s unverified', (_label, overrides) => {
    expect(verifyWalletPayProof(reservation, record(overrides))).toEqual({
      status: 'unverified',
    });
  });

  it('leaves a malformed reservation or body unverified', () => {
    expect(verifyWalletPayProof({ operationId: OP }, record())).toEqual({
      status: 'unverified',
    });
    expect(verifyWalletPayProof(reservation, { status: true })).toEqual({
      status: 'unverified',
    });
  });
  it('settles the documented "success" status like "successful"', () => {
    expect(
      verifyWalletPayProof(reservation, record({ status: 'success' })).status
    ).toBe('verified');
  });
});
