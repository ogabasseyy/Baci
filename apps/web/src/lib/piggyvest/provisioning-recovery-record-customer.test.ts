import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { recordPiggyvestCreatedCustomer } from './provisioning-recovery-record-customer';

const configuration = {
  environment: 'staging',
  integrationId: '11111111-1111-4111-8111-111111111111',
  expectedMerchantId: '22222222-2222-4222-8222-222222222222',
  expectedBusinessId: 'business',
};
const acknowledgement = {
  intentId: '33333333-3333-4333-8333-333333333333',
  claimToken: '44444444-4444-4444-8444-444444444444',
  providerCustomerId: 'customer',
  providerWalletId: 'wallet',
  newCustomer: true,
};

describe('created customer provenance recorder', () => {
  it('records only explicit new-customer acknowledgements through the dedicated committed RPC', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ rows: [{ outcome: 'awaiting_confirmation' }] });
    expect(
      await recordPiggyvestCreatedCustomer({
        configuration,
        acknowledgement,
        execute,
      })
    ).toBe('awaiting_confirmation');
    expect(execute.mock.calls[0][1]).toEqual([
      configuration.integrationId,
      configuration.expectedMerchantId,
      acknowledgement.intentId,
      acknowledgement.claimToken,
      'business',
      'customer',
      'wallet',
    ]);
  });
  it.each([
    false,
    undefined,
    'true',
  ])('rejects false or missing provider provenance %s before storage', async (newCustomer) => {
    const execute = vi.fn();
    await expect(
      recordPiggyvestCreatedCustomer({
        configuration,
        acknowledgement: { ...acknowledgement, newCustomer },
        execute,
      })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not retry or leak an uncertain commit error', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error('private database error'));
    await expect(
      recordPiggyvestCreatedCustomer({
        configuration,
        acknowledgement,
        execute,
      })
    ).rejects.toThrow(/^PiggyVest recovery storage unavailable$/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects completion or multiple result rows at the recording boundary', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ outcome: 'completed' }] })
      .mockResolvedValueOnce({
        rows: [{ outcome: 'stale' }, { outcome: 'stale' }],
      });
    await expect(
      recordPiggyvestCreatedCustomer({
        configuration,
        acknowledgement,
        execute,
      })
    ).rejects.toThrow();
    await expect(
      recordPiggyvestCreatedCustomer({
        configuration,
        acknowledgement,
        execute,
      })
    ).rejects.toThrow();
  });
});
