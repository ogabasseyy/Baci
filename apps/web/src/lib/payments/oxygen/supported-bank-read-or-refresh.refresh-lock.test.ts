import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { readOrRefreshSupportedBanks } from './supported-bank-read-or-refresh';
import { bankRefreshLockKey } from './supported-bank-refresh-lock';

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
      lockKey: () => bankRefreshLockKey('production', 'partner'),
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
        const lock = cache.lockKey();
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

    expect(cache.store.get(cache.lockKey())).toBe('successor-token');
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
    expect(cache.store.has(cache.lockKey())).toBe(true);
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
    cache.store.delete(cache.lockKey()); // the lock TTL elapsing

    expect(await read()).toEqual([bank]);
    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(cache.store.has(cache.lockKey())).toBe(false);
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

  it('does not call the provider while the scheduled recovery job holds the lock', async () => {
    const cache = redisLike();
    // The cron route claims the same key with its own token before checkout runs.
    cache.store.set(cache.lockKey(), 'cron-token');
    const provider = { call: vi.fn().mockResolvedValue(providerList) };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      )
    ).toBeNull();

    expect(provider.call).not.toHaveBeenCalled();
    expect(cache.store.get(cache.lockKey())).toBe('cron-token');
  });

  it('returns the list the lock holder wrote while this request was losing the race', async () => {
    const cache = redisLike();
    cache.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ banks: [bank] });
    cache.store.set(cache.lockKey(), 'holder-token');
    const provider = { call: vi.fn().mockResolvedValue(providerList) };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      )
    ).toEqual([bank]);

    expect(provider.call).not.toHaveBeenCalled();
    expect(cache.store.get(cache.lockKey())).toBe('holder-token');
  });

  it('logs the provider failure outcome without its message or diagnostic', async () => {
    logger.error.mockClear();
    const cache = redisLike();
    const failure = Object.assign(
      new Error('Oxygen request could not be confirmed'),
      {
        outcome: 'not_sent',
        diagnostic: { body: 'sk_live_diag' },
      }
    );
    const provider = { call: vi.fn().mockRejectedValue(failure) };

    await readOrRefreshSupportedBanks(
      cache,
      'production',
      'partner',
      () => provider
    );

    expect(logger.error).toHaveBeenCalledWith({
      message: 'Oxygen supported-bank refresh failed',
      environment: 'production',
      errorName: 'Error',
      outcome: 'not_sent',
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'sk_live_diag'
    );
  });

  it('ignores an unrecognised outcome value when logging a failed refresh', async () => {
    logger.error.mockClear();
    const cache = redisLike();
    const failure = Object.assign(new Error('x'), {
      outcome: 'free text body',
    });
    const provider = { call: vi.fn().mockRejectedValue(failure) };

    await readOrRefreshSupportedBanks(
      cache,
      'production',
      'partner',
      () => provider
    );

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      'free text body'
    );
  });

  it('claims a lock window that outlasts a cold login plus a bank request', async () => {
    const cache = redisLike();
    const provider = { call: vi.fn().mockResolvedValue(providerList) };

    await readOrRefreshSupportedBanks(
      cache,
      'production',
      'partner',
      () => provider
    );

    // The partner login and the bank request each allow 30s, so the lock must
    // not expire before a cold refresh can finish.
    const options = cache.set.mock.calls[0][2];
    expect(options?.ex).toBeGreaterThan(30 + 30);
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
