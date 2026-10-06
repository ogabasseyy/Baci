import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reconcilePiggyvestTransaction } from './transaction-reconciliation';

const configuration = {
  apiBaseUrl: 'https://staging.piggyvest.business',
  apiSecret: 'synthetic-secret',
  expectedBusinessId: 'business-test',
  timeoutMs: 100,
  maxResponseBytes: 4096,
};
const binding = {
  transactionId: 'transaction-test',
  walletId: 'wallet-test',
  customerId: 'customer-test',
  businessId: 'business-test',
};
const transaction = {
  id: binding.transactionId,
  customer_id: binding.customerId,
  source_wallet: 'external-wallet',
  destination_wallet: binding.walletId,
  status: 'successful',
  amount: 125.5,
  fee: 0,
  category: 'undocumented-category',
  reference: 'synthetic-reference',
  break_down: {
    gross_interest_payout: 10,
    withholding_tax: 1,
    net_interest_payout: 9,
  },
};

function transport(
  data: unknown = transaction,
  businessId = binding.businessId
) {
  return vi.fn().mockImplementation(async (url: string) =>
    Response.json({
      status: true,
      data: url.includes('/wallet/')
        ? {
            id: binding.walletId,
            business_id: businessId,
            currency: 'NGN',
            balance: 0,
            status: 'active',
          }
        : data,
    })
  );
}

describe('read-only transaction reconciliation', () => {
  it('accepts the bound source wallet without classifying a debit', async () => {
    const result = await reconcilePiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation: transport({
        ...transaction,
        source_wallet: binding.walletId,
        destination_wallet: 'other',
      }),
    });
    expect(result).toMatchObject({
      kind: 'verified_observation',
      financialEffects: 'UNKNOWN',
    });
  });

  it('rejects mismatched server business configuration without HTTP', async () => {
    const fetchImplementation = transport();
    expect(
      await reconcilePiggyvestTransaction({
        configuration,
        binding: { ...binding, businessId: 'other' },
        fetchImplementation,
      })
    ).toMatchObject({
      kind: 'ownership_gap',
      reason: 'BUSINESS_BINDING_MISMATCH',
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('returns a stable gap for transaction HTTP failure and logs no payload', async () => {
    const fetchImplementation = transport();
    fetchImplementation
      .mockImplementationOnce(async () =>
        Response.json({
          status: true,
          data: {
            id: binding.walletId,
            business_id: binding.businessId,
            currency: 'NGN',
            balance: 0,
            status: 'active',
          },
        })
      )
      .mockRejectedValueOnce(new Error('private transaction payload'));
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    try {
      expect(
        await reconcilePiggyvestTransaction({
          configuration,
          binding,
          fetchImplementation,
        })
      ).toEqual({
        kind: 'needs_contract',
        financialEffects: 'UNKNOWN',
        reason: 'TRANSACTION_READ_UNAVAILABLE',
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('verifies wallet business and exact transaction/customer ownership without financial effects', async () => {
    const fetchImplementation = transport({
      ...transaction,
      meta: { secret: 'omit' },
    });
    const result = await reconcilePiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation,
    });

    expect(result).toMatchObject({
      kind: 'verified_observation',
      financialEffects: 'UNKNOWN',
      observation: transaction,
    });
    expect(JSON.stringify(result)).not.toContain('omit');
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenLastCalledWith(
      'https://staging.piggyvest.business/api/v1/transaction/transaction-test?wallet_id=wallet-test',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
      })
    );
  });

  it.each([
    { id: 'other' },
    { customer_id: 'other' },
    { destination_wallet: 'other' },
  ])('rejects ownership mismatch %j', async (override) => {
    const result = await reconcilePiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation: transport({ ...transaction, ...override }),
    });
    expect(result).toMatchObject({
      kind: 'ownership_gap',
      financialEffects: 'UNKNOWN',
    });
    expect(result).not.toHaveProperty('observation');
  });

  it('rejects a different wallet business before transaction retrieval', async () => {
    const fetchImplementation = transport(transaction, 'other-business');
    expect(
      await reconcilePiggyvestTransaction({
        configuration,
        binding,
        fetchImplementation,
      })
    ).toMatchObject({ kind: 'ownership_gap' });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    'pending',
    'failed',
    'partial',
    'future-status',
  ])('never derives settlement from %s', async (status) => {
    const result = await reconcilePiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation: transport({ ...transaction, status }),
    });
    expect(result).toMatchObject({
      kind: 'verified_observation',
      financialEffects: 'UNKNOWN',
      observation: { status },
    });
  });

  it.each([
    '.',
    '..',
    '../other',
    '%2e%2e',
    ' wallet',
    'wallet\n',
    'wallet/other',
    'wallet?x=1',
    '\ud800',
  ])('rejects unsafe binding before HTTP: %j', async (walletId) => {
    const fetchImplementation = transport();
    expect(
      await reconcilePiggyvestTransaction({
        configuration,
        binding: { ...binding, walletId },
        fetchImplementation,
      })
    ).toMatchObject({ kind: 'ownership_gap' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('requires explicit bounded staging configuration before HTTP', async () => {
    const fetchImplementation = transport();
    for (const override of [
      { apiBaseUrl: 'https://api.piggyvest.business' },
      { timeoutMs: undefined },
      { maxResponseBytes: 65537 },
    ]) {
      expect(
        await reconcilePiggyvestTransaction({
          configuration: { ...configuration, ...override },
          binding,
          fetchImplementation,
        })
      ).toMatchObject({ kind: 'needs_contract' });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects missing customer ownership and malformed documented values', async () => {
    for (const override of [
      { customer_id: undefined },
      { amount: '125' },
      { break_down: { net_interest_payout: 9 } },
    ]) {
      expect(
        await reconcilePiggyvestTransaction({
          configuration,
          binding,
          fetchImplementation: transport({ ...transaction, ...override }),
        })
      ).toMatchObject({ kind: 'needs_contract', financialEffects: 'UNKNOWN' });
    }
  });

  it('does not expose provider error contents or retry', async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error('private provider data'));
    const result = await reconcilePiggyvestTransaction({
      configuration,
      binding,
      fetchImplementation,
    });
    expect(result).toMatchObject({
      kind: 'needs_contract',
      financialEffects: 'UNKNOWN',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
