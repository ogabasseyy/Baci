import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { readOrRefreshSupportedBanks } from './supported-bank-cache';

const bank = { name: 'Example Bank', code: '001' };

describe('bugfix: refresh lock fencing and failure cooldown', () => {
  const providerList = {
    Status: '00',
    Result: [{ Name: 'Example Bank', SortCode: '001' }],
  };
  // Behaves like Redis: DEL is unconditional, only the Lua release is fenced.
  function redisLike() {
    const store = new Map<string, unknown>();
    return {
      store,
      lockKey: () => [...store.keys()].find((k) => k.endsWith(':refresh-lock')),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(
        async (k: string, v: unknown, o?: { nx?: boolean; ex?: number }) => {
          if (o?.nx && store.has(k)) return null;
          store.set(k, v);
          return 'OK';
        }
      ),
      del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      eval: vi.fn(async (_script: string, keys: string[], args: string[]) => {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }),
    };
  }

  it('does not delete a successor lock when the refresh outlives the lock window', async () => {
    const cache = redisLike();
    const provider = {
      call: vi.fn(async () => {
        // The 60s lock expired mid-refresh and another request claimed a new one.
        const lock = cache.lockKey() as string;
        cache.store.delete(lock);
        await cache.set(lock, 'successor-token', { nx: true, ex: 60 });
        return providerList;
      }),
    };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      )
    ).toEqual([bank]);

    expect(cache.store.get(cache.lockKey() as string)).toBe('successor-token');
  });

  it('keeps the lock after a failed refresh so the lock window is the cooldown', async () => {
    const cache = redisLike();
    const provider = {
      call: vi.fn().mockRejectedValue(new Error('provider down')),
    };
    const read = () =>
      readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      );

    expect(await read()).toBeNull();
    expect(await read()).toBeNull();
    expect(await read()).toBeNull();

    expect(provider.call).toHaveBeenCalledTimes(1);
    expect(cache.eval).not.toHaveBeenCalled();
    expect(cache.lockKey()).toBeDefined();
  });

  it('retries the provider once the failure cooldown has expired', async () => {
    const cache = redisLike();
    const provider = {
      call: vi
        .fn()
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce(providerList),
    };
    const read = () =>
      readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      );

    expect(await read()).toBeNull();
    cache.store.delete(cache.lockKey() as string); // the lock TTL elapsing

    expect(await read()).toEqual([bank]);
    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(cache.lockKey()).toBeUndefined();
  });

  it('logs a failed refresh without the provider error text', async () => {
    logger.error.mockClear();
    const cache = redisLike();
    const provider = {
      call: vi
        .fn()
        .mockRejectedValue(new Error('upstream body {"secret":"sk_live_x"}')),
    };

    await readOrRefreshSupportedBanks(
      cache,
      'production',
      'partner',
      () => provider
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Oxygen supported-bank refresh failed',
        environment: 'production',
        errorName: 'Error',
      })
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sk_live_x');
  });

  it('still returns the list when releasing the lock fails', async () => {
    const cache = redisLike();
    cache.eval.mockRejectedValue(new Error('redis unavailable'));
    const provider = { call: vi.fn().mockResolvedValue(providerList) };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      )
    ).toEqual([bank]);
  });
});
