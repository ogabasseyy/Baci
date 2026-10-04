import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createPiggyvestProvisioningStore } from './provisioning-store';

const configuration = {
  environment: 'staging',
  integrationId: '11111111-1111-4111-8111-111111111111',
  expectedMerchantId: '22222222-2222-4222-8222-222222222222',
  expectedBusinessId: 'synthetic-business',
};
const identity = {
  kind: 'create_customer' as const,
  merchantId: configuration.expectedMerchantId,
  customerId: '33333333-3333-4333-8333-333333333333',
  goalId: null,
  providerCustomerId: null,
  requestFingerprint: 'ab'.repeat(32),
};
const intentId = '44444444-4444-4444-8444-444444444444';
const claimToken = '55555555-5555-4555-8555-555555555555';
const claim = {
  intent_id: intentId,
  operation: identity.kind,
  merchant_id: identity.merchantId,
  customer_id: identity.customerId,
  goal_id: null,
  request_fingerprint: identity.requestFingerprint,
  claim_token: claimToken,
  attempts: 1,
  lease_expires_at_ms: Date.parse('2099-01-01T00:00:00Z'),
};

describe('createPiggyvestProvisioningStore', () => {
  it('stores only canonical identities and a keyed fingerprint as bound parameters', async () => {
    const execute = vi.fn().mockResolvedValue({
      rows: [{ intent_id: intentId, outcome: 'accepted', status: 'pending' }],
    });
    const store = createPiggyvestProvisioningStore({ configuration, execute });

    expect(await store.prepare(identity)).toEqual({
      intentId,
      outcome: 'accepted',
      status: 'pending',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('prepare_provisioning_intent($1::uuid'),
      [
        configuration.integrationId,
        configuration.expectedMerchantId,
        identity.customerId,
        null,
        identity.kind,
        Buffer.from(identity.requestFingerprint, 'hex'),
      ]
    );
  });

  it('binds provider account and expected customer identity when claiming', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [claim] });
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    expect(await store.claim(intentId, identity)).toBe(claimToken);
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.expectedMerchantId,
      intentId,
      60,
      configuration.expectedBusinessId,
      null,
    ]);
  });

  it('passes the plan customer binding rather than relying only on caller wallet selection', async () => {
    const goalId = '66666666-6666-4666-8666-666666666666';
    const execute = vi.fn().mockResolvedValue({
      rows: [{ ...claim, operation: 'create_plan_wallet', goal_id: goalId }],
    });
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    expect(
      await store.claim(intentId, {
        ...identity,
        kind: 'create_plan_wallet',
        goalId,
        providerCustomerId: 'synthetic-provider-customer',
      })
    ).toBe(claimToken);
    expect(execute.mock.calls[0][1][5]).toBe('synthetic-provider-customer');
  });

  it.each([
    { intent_id: '77777777-7777-4777-8777-777777777777' },
    { operation: 'create_plan_wallet' },
    { merchant_id: '77777777-7777-4777-8777-777777777777' },
    { customer_id: '77777777-7777-4777-8777-777777777777' },
    { goal_id: '77777777-7777-4777-8777-777777777777' },
    { request_fingerprint: 'cd'.repeat(32) },
    { attempts: 2 },
    { lease_expires_at_ms: 1 },
    { claim_token: 'invalid' },
  ])('rejects untrusted or expired claimed rows before permitting dispatch', async (change) => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ ...claim, ...change }] });
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    await expect(store.claim(intentId, identity)).rejects.toThrow(
      /^PiggyVest provisioning storage unavailable$/
    );
  });

  it('returns no permit for an empty claim rather than manufacturing a token', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    expect(
      await createPiggyvestProvisioningStore({ configuration, execute }).claim(
        intentId,
        identity
      )
    ).toBeNull();
  });

  it('rejects multiple claim rows and redacts raw database failures', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [claim, claim] })
      .mockRejectedValueOnce(new Error('synthetic-sensitive-database-detail'));
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    await expect(store.claim(intentId, identity)).rejects.toThrow(
      /^PiggyVest provisioning storage unavailable$/
    );
    await expect(store.prepare(identity)).rejects.toThrow(
      /^PiggyVest provisioning storage unavailable$/
    );
  });

  it('does not operate across merchants or with incomplete plan identity', async () => {
    const execute = vi.fn();
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    await expect(
      store.prepare({
        ...identity,
        merchantId: '77777777-7777-4777-8777-777777777777',
      })
    ).rejects.toThrow();
    await expect(
      store.prepare({ ...identity, kind: 'create_plan_wallet' })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('records only opaque recovery references with a fenced token', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ outcome: 'awaiting_confirmation' }] });
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    expect(
      await store.record({
        intentId,
        claimToken,
        resultCode: 'accepted',
        providerCustomerId: 'synthetic-customer',
        providerWalletId: 'synthetic-wallet',
      })
    ).toBe('awaiting_confirmation');
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.expectedMerchantId,
      intentId,
      claimToken,
      'accepted',
      'synthetic-customer',
      'synthetic-wallet',
    ]);
  });

  it.each([
    [],
    [{ outcome: 'completed' }],
    [{ outcome: 'unknown' }, { outcome: 'unknown' }],
  ])('rejects missing, invented or ambiguous result rows', async (...rowArguments) => {
    const execute = vi.fn().mockResolvedValue({ rows: rowArguments });
    const store = createPiggyvestProvisioningStore({ configuration, execute });
    await expect(
      store.record({
        intentId,
        claimToken,
        resultCode: 'ambiguous',
        providerCustomerId: null,
        providerWalletId: null,
      })
    ).rejects.toThrow();
  });

  it('rejects invalid factory configuration without database access', () => {
    const execute = vi.fn();
    expect(() =>
      createPiggyvestProvisioningStore({
        configuration: { ...configuration, environment: 'production' },
        execute,
      })
    ).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
