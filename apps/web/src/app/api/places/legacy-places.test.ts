import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchLegacyPlacesJson } from './legacy-places';

const mockFetch = vi.fn();
beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reserves every retry and stops before making an unbudgeted request', async () => {
  const reserve = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ status: 'UNKNOWN_ERROR' }),
  });
  const pending = fetchLegacyPlacesJson('https://provider.test', reserve);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: false, status: 429 });
  expect(reserve).toHaveBeenCalledTimes(2);
  expect(mockFetch).toHaveBeenCalledOnce();
});

it('does not send a request when the initial reservation fails', async () => {
  expect(
    await fetchLegacyPlacesJson('https://provider.test', async () => false)
  ).toEqual({ ok: false, status: 429 });
  expect(mockFetch).not.toHaveBeenCalled();
});
