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

it.each([
  'TimeoutError',
  'AbortError',
])('retries %s and reserves a new unit before succeeding', async (name) => {
  const reserve = vi.fn(async () => true);
  mockFetch
    .mockRejectedValueOnce(new DOMException('The operation timed out', name))
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'OK' }),
    });
  const pending = fetchLegacyPlacesJson('https://provider.test', reserve);
  await vi.runAllTimersAsync();
  expect(await pending).toMatchObject({ ok: true, data: { status: 'OK' } });
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(reserve).toHaveBeenCalledTimes(2);
});

it('stops timeout retries when the budget is exhausted', async () => {
  const reserve = vi
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  mockFetch.mockRejectedValueOnce(
    new DOMException('Timed out', 'TimeoutError')
  );
  const pending = fetchLegacyPlacesJson('https://provider.test', reserve);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: false, status: 429 });
  expect(mockFetch).toHaveBeenCalledOnce();
});

it('bounds repeated timeout retries at three upstream attempts', async () => {
  const reserve = vi.fn(async () => true);
  const timeout = new DOMException('Timed out', 'TimeoutError');
  mockFetch.mockRejectedValue(timeout);
  const assertion = expect(
    fetchLegacyPlacesJson('https://provider.test', reserve)
  ).rejects.toBe(timeout);
  await vi.runAllTimersAsync();
  await assertion;
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(reserve).toHaveBeenCalledTimes(3);
});
