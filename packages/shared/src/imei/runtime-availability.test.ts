import { describe, expect, it, vi } from 'vitest';
import {
  fetchRuntimeImeiTierKeys,
  filterRuntimeImeiTierKeys,
  parseRuntimeImeiTierKeys,
} from './runtime-availability';

describe('runtime IMEI availability', () => {
  it('keeps provider-only services hidden on unknown or old servers', () => {
    expect(
      filterRuntimeImeiTierKeys(['full', 'esimCompatibility'], null)
    ).toEqual(['full']);
  });
  it('intersects advertised capabilities with local candidates and honors an explicit empty set', () => {
    expect(
      filterRuntimeImeiTierKeys(
        ['full', 'esimCompatibility'],
        ['esimCompatibility', 'samsung']
      )
    ).toEqual(['esimCompatibility']);
    expect(filterRuntimeImeiTierKeys(['full'], [])).toEqual([]);
  });
  it('accepts only a valid key array and ignores unknown future services', () => {
    expect(
      parseRuntimeImeiTierKeys({
        availableTierKeys: ['esimCompatibility', 'future', 'esimCompatibility'],
      })
    ).toEqual(['esimCompatibility']);
    expect(() =>
      parseRuntimeImeiTierKeys({ availableTierKeys: [null] })
    ).toThrow();
    expect(() => parseRuntimeImeiTierKeys({})).toThrow();
  });
  it('requests no-store capabilities for exactly the requested device and async contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ availableTierKeys: [] }),
    });
    expect(
      await fetchRuntimeImeiTierKeys({
        device: 'smartphone',
        apiBaseUrl: 'https://store.example/',
        fetchImpl,
      })
    ).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://store.example/api/storefront/imei-check?device=smartphone&clientCapabilities=imei-async-v1',
      expect.objectContaining({ method: 'GET', cache: 'no-store' })
    );
  });
  it('rejects an old-server 405 instead of inventing provider capabilities', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 405 });
    await expect(
      fetchRuntimeImeiTierKeys({ device: 'smartphone', fetchImpl })
    ).rejects.toThrow('IMEI capability request failed');
  });
});
