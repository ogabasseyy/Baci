import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { recoverPiggyvestProvisioning } from './provisioning-recovery-client';

const configuration = {
  storage: {
    environment: 'staging',
    integrationId: '11111111-1111-4111-8111-111111111111',
    expectedMerchantId: '22222222-2222-4222-8222-222222222222',
    expectedBusinessId: 'business',
  },
  wallet: { apiSecret: 'synthetic', expectedBusinessId: 'business' },
};
const scope = {
  intentId: '33333333-3333-4333-8333-333333333333',
  customerId: '44444444-4444-4444-8444-444444444444',
  goalId: '66666666-6666-4666-8666-666666666666',
};
const row = {
  intent_id: scope.intentId,
  merchant_id: configuration.storage.expectedMerchantId,
  customer_id: scope.customerId,
  goal_id: scope.goalId,
  operation: 'create_plan_wallet',
  status: 'awaiting_confirmation',
  provider_customer_id: 'customer',
  provider_wallet_id: 'wallet',
  dispatch_provider_customer_id: 'customer',
};
const verification = {
  verification_token: '55555555-5555-4555-8555-555555555555',
  provider_wallet_id: 'wallet',
  completed: false,
};
const wallet = {
  status: true,
  data: {
    id: 'wallet',
    business_id: 'business',
    currency: 'NGN',
    status: 'active',
  },
};

describe('bounded provisioning recovery client', () => {
  it('confirms a customer when SQL supplies a provenance-backed verification', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...row,
            operation: 'create_customer',
            goal_id: null,
            dispatch_provider_customer_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [verification] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'completed' }] });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(wallet));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope: { ...scope, goalId: null },
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'completed' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
  it('keeps historical customer acknowledgements without provenance observational', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...row,
            operation: 'create_customer',
            goal_id: null,
            dispatch_provider_customer_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'ownership_unverified' }] });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(wallet));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope: { ...scope, goalId: null },
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'ownership_unverified' });
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it('confirms an acknowledged wallet without inventing a GET customer field', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [verification] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'completed' }] });
    const fetchImplementation = vi.fn().mockImplementation(async () => {
      expect(execute).toHaveBeenCalledTimes(2);
      return Response.json(wallet);
    });
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'completed' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0][1].method).toBe('GET');
    expect(execute.mock.calls[2][1].slice(6)).toEqual([
      verification.verification_token,
      'wallet',
      'business',
      'NGN',
      'active',
    ]);
  });

  it('does not retrieve, confirm or resend unknown outcomes without a wallet ID', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            ...row,
            status: 'unknown',
            provider_wallet_id: null,
            provider_customer_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ outcome: 'missing_reference' }] });
    const fetchImplementation = vi.fn();
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'missing_reference' });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(
      execute.mock.calls.some(([statement]) =>
        statement.includes('confirm_provisioning')
      )
    ).toBe(false);
  });

  it('keeps unknown outcomes with IDs observational even after matching GET', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ...row, status: 'unknown' }] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'ownership_unverified' }] });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(wallet));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'ownership_unverified' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    'wallet_mismatch',
    'wallet_not_active',
    'stale',
    'mapping_conflict',
  ])('preserves SQL confirmation outcome %s', async (outcome) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [verification] })
      .mockResolvedValueOnce({ rows: [{ outcome }] });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(wallet));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: outcome });
  });

  it('records failed lookup without confirming or retrying', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [verification] })
      .mockResolvedValueOnce({ rows: [{ outcome: 'lookup_unavailable' }] });
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error('sensitive response'));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'lookup_unavailable' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('never starts GET after an uncertain snapshot commit', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockRejectedValueOnce(new Error('commit uncertain'));
    const fetchImplementation = vi.fn();
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'storage_unavailable' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('does not report completion after an uncertain confirmation commit', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [verification] })
      .mockRejectedValueOnce(new Error('commit uncertain'));
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(Response.json(wallet));
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'storage_unavailable' });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('returns an existing durable completion without another GET', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ ...verification, completed: true }] });
    const fetchImplementation = vi.fn();
    expect(
      await recoverPiggyvestProvisioning({
        configuration,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'completed' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects changed business configuration before accessing storage', async () => {
    const execute = vi.fn();
    const fetchImplementation = vi.fn();
    const changed = {
      ...configuration,
      wallet: { ...configuration.wallet, expectedBusinessId: 'other' },
    };
    expect(
      await recoverPiggyvestProvisioning({
        configuration: changed,
        scope,
        execute,
        fetchImplementation,
      })
    ).toEqual({ status: 'not_ready' });
    expect(execute).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
