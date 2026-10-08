import { describe, expect, it, vi } from 'vitest';
import {
  recordPiggyvestWalletMapping,
  resolvePiggyvestWalletMapping,
} from './wallet-mapping';

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
  restriction_status: 'ready',
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
      restrictionStatus: mapping.restriction_status,
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT merchant_id, customer_id, goal_id, restriction_status FROM piggyvest_staging.resolve_wallet_mapping($1::uuid, $2::text, $3::text)',
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
  it('surfaces a restricted mapping instead of hiding it', async () => {
    const execute = vi.fn(async () => ({
      rows: [{ ...mapping, restriction_status: 'restricted' }],
    }));
    expect(
      await resolvePiggyvestWalletMapping({ configuration, input, execute })
    ).toEqual({
      merchantId: mapping.merchant_id,
      customerId: mapping.customer_id,
      goalId: mapping.goal_id,
      restrictionStatus: 'restricted',
    });
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

describe('recordPiggyvestWalletMapping', () => {
  const recordInput = {
    providerWalletId: 'synthetic-wallet',
    providerCustomerId: 'synthetic-customer',
    merchantId: configuration.expectedMerchantId,
    customerId: '00000000-0000-4000-8000-000000000003',
    goalId: '00000000-0000-4000-8000-000000000004',
  };

  it('records the binding with the full identity scope', async () => {
    const execute = vi.fn(async () => ({ rows: [{ recorded: true }] }));

    await expect(
      recordPiggyvestWalletMapping({
        configuration,
        input: recordInput,
        execute,
      })
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      'SELECT piggyvest_staging.record_wallet_goal_mapping($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::uuid) AS recorded',
      [
        configuration.integrationId,
        recordInput.providerWalletId,
        recordInput.providerCustomerId,
        recordInput.merchantId,
        recordInput.customerId,
        recordInput.goalId,
      ]
    );
  });

  it('refuses a cross-merchant record without querying', async () => {
    const execute = vi.fn();

    await expect(
      recordPiggyvestWalletMapping({
        configuration,
        input: { ...recordInput, merchantId: recordInput.customerId },
        execute,
      })
    ).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { rows: [] },
    { rows: [{ recorded: false }] },
    { rows: [{}] },
  ])('fails closed when durability cannot be proven', async (response) => {
    await expect(
      recordPiggyvestWalletMapping({
        configuration,
        input: recordInput,
        execute: async () => response,
      })
    ).resolves.toBe(false);
  });

  it('redacts SQL failures instead of throwing', async () => {
    const execute = vi.fn(async () => {
      throw new Error('sensitive SQL detail');
    });

    await expect(
      recordPiggyvestWalletMapping({
        configuration,
        input: recordInput,
        execute,
      })
    ).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
