import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPiggyvestProvisioningRecoveryStore } from './provisioning-recovery-store';

const configuration = {
  environment: 'staging',
  integrationId: '11111111-1111-4111-8111-111111111111',
  expectedMerchantId: '22222222-2222-4222-8222-222222222222',
  expectedBusinessId: 'business',
};
const scope = {
  intentId: '33333333-3333-4333-8333-333333333333',
  customerId: '44444444-4444-4444-8444-444444444444',
  goalId: null,
};
const row = {
  intent_id: scope.intentId,
  merchant_id: configuration.expectedMerchantId,
  customer_id: scope.customerId,
  goal_id: null,
  operation: 'create_customer',
  status: 'awaiting_confirmation',
  provider_customer_id: 'customer',
  provider_wallet_id: 'wallet',
  dispatch_provider_customer_id: null,
};

describe('provisioning recovery store', () => {
  it('reads only the configured merchant and supplied local customer mapping scope', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ outcome: 'mapped', provider_customer_id: 'customer' }],
    });
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    await expect(store.readCustomerMapping(scope.customerId)).resolves.toEqual({
      outcome: 'mapped',
      provider_customer_id: 'customer',
    });
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.expectedMerchantId,
      scope.customerId,
      configuration.expectedBusinessId,
    ]);
  });

  it.each([
    { outcome: 'mapped', provider_customer_id: null },
    { outcome: 'none', provider_customer_id: 'untrusted' },
    { outcome: 'conflict', provider_customer_id: 'untrusted' },
  ])('rejects inconsistent customer mapping results %j', async (result) => {
    const execute = vi.fn().mockResolvedValue({ rows: [result] });
    await expect(
      createPiggyvestProvisioningRecoveryStore({
        configuration,
        execute,
      }).readCustomerMapping(scope.customerId)
    ).rejects.toThrow('PiggyVest recovery storage unavailable');
  });

  it('rejects malformed customer scope before querying storage', async () => {
    const execute = vi.fn();
    await expect(
      createPiggyvestProvisioningRecoveryStore({
        configuration,
        execute,
      }).readCustomerMapping('not-a-customer-id')
    ).rejects.toThrow('PiggyVest recovery storage unavailable');
    expect(execute).not.toHaveBeenCalled();
  });

  it('reads durable references only through the exact scoped function', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row] });
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    expect(await store.read(scope)).toEqual(row);
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.expectedMerchantId,
      scope.customerId,
      null,
      scope.intentId,
      configuration.expectedBusinessId,
    ]);
  });

  it.each([
    { customer_id: configuration.integrationId },
    { merchant_id: configuration.integrationId },
    { intent_id: configuration.integrationId },
    { goal_id: configuration.integrationId },
    { status: 'completed' },
  ])('fails closed on mismatched recovery projection %j', async (change) => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ ...row, ...change }] });
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    await expect(store.read(scope)).rejects.toThrow(
      'PiggyVest recovery storage unavailable'
    );
  });

  it('returns null for absent or excluded intents', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    expect(
      await createPiggyvestProvisioningRecoveryStore({
        configuration,
        execute,
      }).read(scope)
    ).toBeNull();
  });

  it('rejects supplied provider identities before database access', async () => {
    const execute = vi.fn();
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    await expect(
      store.read({ ...scope, providerWalletId: 'chosen' })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('records observational evidence and never accepts completed as an outcome', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ outcome: 'ownership_unverified' }] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'completed' }] });
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    const observation = {
      id: 'wallet',
      business_id: 'business',
      currency: 'NGN',
      status: 'active',
    };
    expect(await store.observe(scope, observation)).toBe(
      'ownership_unverified'
    );
    await expect(store.observe(scope, observation)).rejects.toThrow();
  });

  it('redacts database failures and rejects multiple rows', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('private detail'))
      .mockResolvedValueOnce({ rows: [row, row] });
    const store = createPiggyvestProvisioningRecoveryStore({
      configuration,
      execute,
    });
    await expect(store.read(scope)).rejects.toThrow(
      /^PiggyVest recovery storage unavailable$/
    );
    await expect(store.read(scope)).rejects.toThrow(
      /^PiggyVest recovery storage unavailable$/
    );
  });
});
