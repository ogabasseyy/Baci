import { afterEach, expect, it, vi } from 'vitest';
import { fetchDeviceSuggestions } from './fetch-imei-device-suggestions';

afterEach(() => vi.unstubAllGlobals());
it('keeps suggestion request failures optional', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  expect(await fetchDeviceSuggestions('phone')).toBeNull();
});
it('returns only the display fields needed for device suggestions', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'p', name: 'Phone', secret: 'unused' }],
      }),
    })
  );
  expect(await fetchDeviceSuggestions('phone')).toEqual([
    { id: 'p', name: 'Phone', category: undefined, image: undefined },
  ]);
});
