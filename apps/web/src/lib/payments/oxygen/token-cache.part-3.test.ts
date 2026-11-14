import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenTokenCache } from './token-cache';

// Synthetic fixtures only; no real provider material.
const T = 1_786_000_000_000;
const KEY_A = { accountLabel: 'syn-acct-checking', environment: 'syn-sandbox' };
const KEY_B = { accountLabel: 'syn-acct-savings', environment: 'syn-sandbox' };

const SECRET_1 = 'syn-cache-secret-aaa1';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cache identity across an asynchronous login', () => {
  it.each([
    'caller',
    'login adapter',
  ])('preserves the original key when the %s mutates its key object', async (mutator) => {
    let currentTime = T;
    const gate = deferred<{ token: string; expiresAtMs: number }>();
    const suppliedKey = { ...KEY_A };
    let calls = 0;
    const login = vi.fn(
      (key: { accountLabel: string; environment: string }) => {
        calls += 1;
        if (calls === 1) {
          if (mutator === 'login adapter') Object.assign(key, KEY_B);
          return gate.promise;
        }
        return Promise.resolve({
          token: 'syn-fresh-token',
          expiresAtMs: currentTime + 300_000,
        });
      }
    );
    const cache = createOxygenTokenCache({ login, now: () => currentTime });
    const first = cache.getToken(suppliedKey, { secret: SECRET_1 });
    if (mutator === 'caller') Object.assign(suppliedKey, KEY_B);
    gate.resolve({ token: 'syn-original-token', expiresAtMs: T + 300_000 });
    await first;

    currentTime = T + 300_000;
    const renewed = await cache.getToken({ ...KEY_A }, { secret: SECRET_1 });
    expect(renewed.token).toBe('syn-fresh-token');
    expect(renewed.expiresAtMs).toBeGreaterThan(currentTime);
  });
});

it('anchors the skew to login start when a slow login consumes the remaining safe lifetime', async () => {
  let currentTime = T;
  const gate = deferred<{ token: string; expiresAtMs: number }>();
  const login = vi
    .fn()
    .mockImplementationOnce(() => gate.promise)
    .mockImplementationOnce(async () => ({
      token: 'syn-refreshed',
      expiresAtMs: currentTime + 100_000,
    }));
  const cache = createOxygenTokenCache({
    login,
    now: () => currentTime,
    expirySkewMs: 30_000,
  });
  const first = cache.getToken(KEY_A, { secret: SECRET_1 });
  currentTime = T + 70_000;
  gate.resolve({ token: 'syn-slow', expiresAtMs: T + 100_000 });
  expect((await first).token).toBe('syn-slow');
  expect(login).toHaveBeenCalledTimes(1);
  expect((await cache.getToken(KEY_A, { secret: SECRET_1 })).token).toBe(
    'syn-refreshed'
  );
  expect(login).toHaveBeenCalledTimes(2);
});

it('returns a short-lived login once without an automatic refresh loop after latency consumes its margin', async () => {
  let currentTime = T;
  const gate = deferred<{ token: string; expiresAtMs: number }>();
  const login = vi.fn(() => gate.promise);
  const cache = createOxygenTokenCache({ login, now: () => currentTime });
  const first = cache.getToken(KEY_A, { secret: SECRET_1 });
  const joined = cache.getToken(KEY_A, { secret: SECRET_1 });
  currentTime = T + 4_000;
  gate.resolve({ token: 'syn-short', expiresAtMs: T + 5_000 });
  expect((await first).token).toBe('syn-short');
  expect((await joined).token).toBe('syn-short');
  expect(login).toHaveBeenCalledTimes(1);
});
