import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { retryVerifierBusy } from './verifier-backpressure';

vi.mock('node:timers/promises', async (importOriginal) => {
  const timers = await importOriginal<typeof import('node:timers/promises')>();
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.mocked(delay).mockReset();
  vi.useRealTimers();
});

function advanceClockDuringBackoff() {
  vi.mocked(delay).mockImplementation(async (milliseconds, value) => {
    vi.setSystemTime(Date.now() + (milliseconds ?? 0));
    return value;
  });
}

it('returns success after a capacity response', async () => {
  advanceClockDuringBackoff();
  const send = vi.fn().mockResolvedValueOnce(429).mockResolvedValueOnce(204);
  const pending = retryVerifierBusy(send, 429, new AbortController().signal);
  await expect(pending).resolves.toBe(204);
  expect(send).toHaveBeenCalledTimes(2);
});

it('returns the last capacity response when the retry window ends', async () => {
  advanceClockDuringBackoff();
  const start = Date.now();
  const attempts: number[] = [];
  const send = async () => {
    attempts.push(Date.now() - start);
    return 429;
  };
  const pending = retryVerifierBusy(send, 429, new AbortController().signal);
  await expect(pending).resolves.toBe(429);
  expect(attempts.at(-1)).toBe(74_000);
  expect(Date.now() - start).toBe(75_000);
});

it('stops retrying if cancelled during backoff', async () => {
  const controller = new AbortController();
  const send = vi.fn().mockResolvedValue(429);
  const pending = retryVerifierBusy(send, 429, controller.signal);
  await Promise.resolve();
  expect(delay).toHaveBeenCalledOnce();
  controller.abort();
  await expect(pending).resolves.toBe(429);
  expect(send).toHaveBeenCalledTimes(1);
});

it('returns non-capacity statuses and propagates transport failures without retrying', async () => {
  const failure = Error('Transport failed');
  const send = vi
    .fn()
    .mockResolvedValueOnce(503)
    .mockRejectedValueOnce(failure);
  const { signal } = new AbortController();
  await expect(retryVerifierBusy(send, 429, signal)).resolves.toBe(503);
  expect(send).toHaveBeenCalledTimes(1);
  await expect(retryVerifierBusy(send, 429, signal)).rejects.toBe(failure);
  expect(send).toHaveBeenCalledTimes(2);
});
