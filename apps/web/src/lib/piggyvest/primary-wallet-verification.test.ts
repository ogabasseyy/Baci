import { describe, expect, it, vi } from 'vitest';
import {
  PRIMARY_WALLET_VERIFICATION_STATEMENT,
  verifyPrimaryWalletMapping,
} from './primary-wallet-verification';

vi.mock('server-only', () => ({}));

function fixture() {
  return {
    scope: {
      merchantId: '00000000-0000-4000-8000-000000000001',
      customerId: '00000000-0000-4000-8000-000000000002',
      userId: '00000000-0000-4000-8000-000000000003',
      integrationId: '00000000-0000-4000-8000-000000000004',
      businessId: 'fixture-business',
      environment: 'staging' as const,
    },
    proof: {
      mapping: { providerCustomerId: 'customer', providerWalletId: 'wallet' },
      wallet: {
        id: 'wallet',
        api_customer_id: 'customer',
        business_id: 'fixture-business',
        currency: 'NGN',
        status: 'active',
        balance: 0,
      },
      accounts: [
        {
          account_number: '0123456789',
          account_name: 'Synthetic Customer',
          bank_name: 'Synthetic Bank',
        },
      ],
    },
    execute: vi.fn().mockResolvedValue({ rows: [{ result: true }] }),
  };
}

describe('primary wallet durable verification', () => {
  it('submits exact accepted identities and provider readiness without bank or profile data', async () => {
    const input = fixture();
    expect(await verifyPrimaryWalletMapping(input)).toBe(true);
    expect(input.execute).toHaveBeenCalledWith(
      PRIMARY_WALLET_VERIFICATION_STATEMENT,
      [
        JSON.stringify(input.scope),
        JSON.stringify({
          providerCustomerId: 'customer',
          providerWalletId: 'wallet',
          businessId: 'fixture-business',
          currency: 'NGN',
          status: 'active',
          hasFundingAccount: true,
        }),
      ]
    );
  });

  it.each([
    { id: 'other-wallet' },
    { api_customer_id: 'other-customer' },
    { business_id: 'other-business' },
    { status: 'pending' },
  ])('does not verify mismatched or inactive provider evidence %j', async (change) => {
    const input = fixture();
    Object.assign(input.proof.wallet, change);
    expect(await verifyPrimaryWalletMapping(input)).toBe(false);
    expect(input.execute).not.toHaveBeenCalled();
  });

  it.each([
    { currency: 'USD' },
    { balance: 0.1 },
    { id: '' },
  ])('rejects malformed provider evidence before accessing storage %j', async (change) => {
    const input = fixture();
    Object.assign(input.proof.wallet, change);
    await expect(verifyPrimaryWalletMapping(input)).rejects.toThrow(
      'Primary wallet verification unavailable'
    );
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('does not verify a wallet without a valid funding account', async () => {
    const input = fixture();
    input.proof.accounts = [];
    await expect(verifyPrimaryWalletMapping(input)).rejects.toThrow(
      'Primary wallet verification unavailable'
    );
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('requires authenticated scope rather than a phone or email lookup', async () => {
    const input = fixture();
    input.scope.userId = '';
    await expect(verifyPrimaryWalletMapping(input)).rejects.toThrow(
      'Primary wallet verification unavailable'
    );
    expect(input.execute).not.toHaveBeenCalled();
  });

  it('preserves database rejection of stale or foreign mappings', async () => {
    const input = fixture();
    input.execute.mockResolvedValue({ rows: [{ result: false }] });
    expect(await verifyPrimaryWalletMapping(input)).toBe(false);
  });

  it.each([
    { rows: [] },
    { rows: [{ result: true }, { result: true }] },
    { rows: [{ result: 'true' }] },
  ])('fails closed on malformed persistence acknowledgements %j', async (response) => {
    const input = fixture();
    input.execute.mockResolvedValue(response);
    await expect(verifyPrimaryWalletMapping(input)).rejects.toThrow(
      'Primary wallet verification unavailable'
    );
  });

  it('does not expose database errors or provider identities on failure', async () => {
    const input = fixture();
    input.execute.mockRejectedValue(new Error('private fixture details'));
    await expect(verifyPrimaryWalletMapping(input)).rejects.toThrow(
      /^Primary wallet verification unavailable$/
    );
  });
});
