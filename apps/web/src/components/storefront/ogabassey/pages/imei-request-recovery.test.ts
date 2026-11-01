import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireImeiRecoveryKey, clearImeiRecoveryKey } from './imei-request-recovery';

describe('IMEI request recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, fn: () => unknown) => fn() } });
  });
  it('reuses the same key after a restart and rotates only after confirmation', async () => {
    const create = vi.fn().mockReturnValueOnce('11111111-1111-4111-8111-111111111111').mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
    const identity = ['store:user', 'blacklist', '490154203237518'];
    const first = await acquireImeiRecoveryKey(identity, create);
    expect(await acquireImeiRecoveryKey(identity, create)).toEqual(first);
    await clearImeiRecoveryKey(first.storageKey, first.idempotencyKey);
    expect((await acquireImeiRecoveryKey(identity, create)).idempotencyKey).toBe('22222222-2222-4222-8222-222222222222');
  });
  it('does not share retry keys across users or tiers', async () => {
    const create = vi.fn().mockReturnValueOnce('a').mockReturnValueOnce('b');
    const a = await acquireImeiRecoveryKey(['user-a', 'blacklist', '490154203237518'], create);
    const b = await acquireImeiRecoveryKey(['user-b', 'blacklist', '490154203237518'], create);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
  });
  it('does not permit submission when durable storage fails', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(acquireImeiRecoveryKey(['scope', 'blacklist', '490154203237518'], () => 'key')).rejects.toThrow();
    vi.restoreAllMocks();
  });
});
