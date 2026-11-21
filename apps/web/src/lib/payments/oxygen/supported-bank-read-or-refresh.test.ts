import { describe, expect, it, vi } from 'vitest';
import { readOrRefreshSupportedBanks } from './supported-bank-read-or-refresh';
import { bankRefreshLockKey } from './supported-bank-refresh-lock';

const bank = { name: 'Example Bank', code: '001' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('cache-first read for checkout', () => {
  const providerList = {
    Status: '00',
    Result: [{ Name: 'Example Bank', SortCode: '001' }],
  };

  it('returns the cached list without claiming a refresh lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue({ banks: [bank] }),
      set: vi.fn(),
      eval: vi.fn(),
    };
    const providerSource = vi.fn();

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        providerSource
      )
    ).toEqual([bank]);

    expect(providerSource).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('repopulates a cold cache and releases only its own refresh lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const provider = { call: vi.fn().mockResolvedValue(providerList) };
    const providerSource = vi.fn().mockReturnValue(provider);

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        providerSource
      )
    ).toEqual([bank]);

    const [lockKey, token] = cache.set.mock.calls[0];
    expect(lockKey).toBe(bankRefreshLockKey('production', 'partner'));
    expect(token).toMatch(UUID);
    expect(cache.set.mock.calls[0][2]).toEqual({ nx: true, ex: 120 });
    expect(cache.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
      [lockKey],
      [token]
    );
  });

  it('leaves the provider alone while another request holds the lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(null),
      eval: vi.fn(),
    };
    const providerSource = vi.fn();

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        providerSource
      )
    ).toBeNull();

    expect(providerSource).not.toHaveBeenCalled();
    expect(cache.eval).not.toHaveBeenCalled();
  });

  it('skips the provider when no runtime matches the configured environment', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => null
      )
    ).toBeNull();
    expect(cache.eval).toHaveBeenCalled();
  });

  it('returns the newly cached list without calling the provider when populated before the lock is claimed', async () => {
    const cache = {
      get: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          banks: [bank],
        }),
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const provider = {
      call: vi.fn().mockRejectedValue(new Error('should not call Oxygen')),
    };
    const providerSource = vi.fn().mockReturnValue(provider);

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        providerSource
      )
    ).toEqual([bank]);
    expect(providerSource).not.toHaveBeenCalled();
    expect(provider.call).not.toHaveBeenCalled();
    expect(cache.eval).toHaveBeenCalled();
  });
});
