import { describe, expect, it, vi } from 'vitest';
import { resolvePiggyvestWalletMapping } from './wallet-mapping';

const configuration = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  expectedMerchantId: '00000000-0000-4000-8000-000000000002',
};
const input = {
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};
const mapping = {
  merchant_id: configuration.expectedMerchantId,
  customer_id: '00000000-0000-4000-8000-000000000003',
  goal_id: '00000000-0000-4000-8000-000000000004',
};

describe('resolvePiggyvestWalletMapping', () => {
  it('resolves both provider identities inside the configured account', async () => {
    const execute = vi.fn(async () => ({ rows: [mapping] }));
    expect(
      await resolvePiggyvestWalletMapping({ configuration, input, execute })
    ).toEqual({
      merchantId: mapping.merchant_id,
      customerId: mapping.customer_id,
      goalId: mapping.goal_id,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT merchant_id, customer_id, goal_id FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
      [
        configuration.integrationId,
        input.providerWalletId,
        input.providerCustomerId,
      ]
    );
  });
  it.each([
    { rows: [] },
    { rows: [mapping, mapping] },
    { rows: [{ ...mapping, merchant_id: mapping.customer_id }] },
  ])('fails closed for missing, ambiguous or cross-merchant mapping', async (response) => {
    expect(
      await resolvePiggyvestWalletMapping({
        configuration,
        input,
        execute: async () => response,
      })
    ).toBeNull();
  });
  it('does not query with body-provided local authority', async () => {
    const execute = vi.fn();
    expect(
      await resolvePiggyvestWalletMapping({
        configuration,
        input: { ...input, merchantId: mapping.merchant_id },
        execute,
      })
    ).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
  it('redacts SQL failures and does not perform a fallback lookup', async () => {
    const execute = vi.fn(async () => {
      throw new Error('sensitive SQL detail');
    });
    expect(
      await resolvePiggyvestWalletMapping({ configuration, input, execute })
    ).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
