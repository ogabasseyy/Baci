import { expect, it, jest } from '@jest/globals';

const mockAcquire = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('@/lib/imei-request-recovery', () => ({
  acquireImeiRecoveryKey: (...args: unknown[]) => mockAcquire(...args),
}));

import { prepareImeiAttempt } from './prepare-imei-attempt';

const base = {
  scope: 'merchant:customer:user',
  tier: 'blacklist' as const,
  identifier: '490154203237518',
  price: 700,
  balance: 0,
  walletLoading: false,
  walletError: false,
  createKey: () => 'key',
};
it('allows a saved attempt to recover even if the wallet balance is now low', async () => {
  mockAcquire.mockResolvedValueOnce({
    storageKey: 'storage',
    idempotencyKey: 'key',
    isExisting: true,
  });
  expect(await prepareImeiAttempt(base)).toMatchObject({
    kind: 'ready',
    recovery: { idempotencyKey: 'key' },
  });
});
it('does not start a new attempt with insufficient funds', async () => {
  mockAcquire.mockResolvedValueOnce({
    storageKey: 'storage',
    idempotencyKey: 'key',
    isExisting: false,
  });
  expect(await prepareImeiAttempt(base)).toEqual({
    kind: 'insufficient',
    shortfall: 700,
  });
});
