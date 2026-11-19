import { describe, expect, it, vi } from 'vitest';
import {
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
