import { describe, expect, it, vi } from 'vitest';
import {
  readOrRefreshSupportedBanks,
  readSupportedBanks,
  refreshSupportedBanks,
} from './supported-bank-cache';

const bank = { name: 'Example Bank', code: '001' };
describe('Oxygen supported bank cache', () => {
  it('separates environments and returns the saved list without contacting Oxygen', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue({ banks: [bank] }),
      set: vi.fn(),
    };
    expect(await readSupportedBanks(cache, 'production', 'partner')).toEqual([
      bank,
    ]);
    expect(cache.get).toHaveBeenCalledWith(
      expect.stringMatching(/^oxygen:supported-banks:production:/)
    );
  });
  it('retains the last saved list when the provider response is invalid', async () => {
    const cache = { get: vi.fn(), set: vi.fn() };
    const provider = {
      call: vi.fn().mockResolvedValue({ Status: 'error', Result: [] }),
    };
    await expect(
      refreshSupportedBanks(cache, provider, 'staging', 'partner')
    ).rejects.toThrow();
    expect(cache.set).not.toHaveBeenCalled();
  });
  it('stores a validated provider list on refresh', async () => {
    const cache = { get: vi.fn(), set: vi.fn().mockResolvedValue('OK') };
    const provider = {
      call: vi.fn().mockResolvedValue({
        Status: '00',
        Result: [{ Name: 'Example Bank', SortCode: '001' }],
      }),
    };
    expect(
      await refreshSupportedBanks(cache, provider, 'staging', 'partner')
    ).toEqual([bank]);
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^oxygen:supported-banks:staging:/),
      { banks: [bank] }
    );
  });
});

describe('cache-first read for checkout', () => {
  const providerList = {
    Status: '00',
    Result: [{ Name: 'Example Bank', SortCode: '001' }],
  };

  it('returns the cached list without claiming a refresh lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue({ banks: [bank] }),
      set: vi.fn(),
      del: vi.fn(),
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

  it('repopulates a cold cache and releases the refresh lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
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

    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/:refresh-lock$/),
      'refreshing',
      { nx: true, ex: 60 }
    );
    expect(cache.del).toHaveBeenCalledWith(
      expect.stringMatching(/:refresh-lock$/)
    );
  });

  it('leaves the provider alone while another request holds the lock', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(null),
      del: vi.fn(),
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
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('releases the lock and reports unavailable when the refresh fails', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };
    const provider = {
      call: vi.fn().mockRejectedValue(new Error('provider down')),
    };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => provider
      )
    ).toBeNull();
    expect(cache.del).toHaveBeenCalled();
  });

  it('skips the provider when no runtime matches the configured environment', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    };

    expect(
      await readOrRefreshSupportedBanks(
        cache,
        'production',
        'partner',
        () => null
      )
    ).toBeNull();
    expect(cache.del).toHaveBeenCalled();
  });
});
