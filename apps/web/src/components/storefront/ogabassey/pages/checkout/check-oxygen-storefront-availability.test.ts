import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkOxygenStorefrontAvailability } from './check-oxygen-storefront-availability';

describe('check Oxygen storefront availability', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([true, false])('returns the server admission decision %s', async (available) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available }) }));
    expect(await checkOxygenStorefrontAvailability('merchant')).toBe(available);
  });
  it.each([null, {}, { available: 'true' }])('fails closed for malformed responses', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
    expect(await checkOxygenStorefrontAvailability('merchant')).toBe(false);
  });
  it('fails closed for network and HTTP errors', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    expect(await checkOxygenStorefrontAvailability('merchant')).toBe(false);
    expect(await checkOxygenStorefrontAvailability('merchant')).toBe(false);
  });
});
