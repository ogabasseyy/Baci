import { beforeEach, expect, it, jest } from '@jest/globals';

const mockEntries = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockEntries.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockEntries.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockEntries.delete(key);
  },
}));

import {
  acquireImeiRecoveryKey,
  clearImeiRecoveryKey,
} from './imei-request-recovery';

beforeEach(() => mockEntries.clear());
it('reuses an uncertain request after restart and rotates after completion', async () => {
  const create = jest
    .fn<() => string>()
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  const identity = ['merchant:customer:user', 'blacklist', '490154203237518'];
  const first = await acquireImeiRecoveryKey(identity, create);
  expect(await acquireImeiRecoveryKey(identity, create)).toMatchObject({
    storageKey: first.storageKey,
    idempotencyKey: first.idempotencyKey,
    isExisting: true,
  });
  await clearImeiRecoveryKey(first.storageKey, first.idempotencyKey);
  expect((await acquireImeiRecoveryKey(identity, create)).idempotencyKey).toBe(
    '22222222-2222-4222-8222-222222222222'
  );
});
