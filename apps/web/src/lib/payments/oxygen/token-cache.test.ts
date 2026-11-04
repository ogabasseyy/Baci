import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

describe('token-cache server-only marker', () => {
  it('declares the server-only marker as the first line', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/payments/oxygen/token-cache.ts'),
      'utf8'
    );
    expect(source.split('\n')[0]).toBe("import 'server-only';");
  });
});

describe('createOxygenTokenCache', () => {
  it('returns the cached token on a hit without re-login', async () => {
    const currentTime = T;
    const login = vi.fn(async () => ({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    }));
    const cache = createOxygenTokenCache({ login, now: () => currentTime });

    const first = await cache.getToken(KEY_A, { secret: SECRET_1 });
    const second = await cache.getToken(KEY_A, { secret: SECRET_1 });

    expect(first).toEqual({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    expect(second).toEqual(first);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(KEY_A, { secret: SECRET_1 });
  });

  it('returns copies so callers cannot mutate the stored entry', async () => {
    const login = vi.fn(async () => ({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    }));
    const cache = createOxygenTokenCache({ login, now: () => T });

    const first = await cache.getToken(KEY_A, { secret: SECRET_1 });
    (first as { token: string }).token = 'mutated';
    const second = await cache.getToken(KEY_A, { secret: SECRET_1 });

    expect(second.token).toBe('syn-token-aaa');
  });

  it('applies the default 60s skew: hit at T+239999, miss at T+240000', async () => {
    let currentTime = T;
    let calls = 0;
    const login = vi.fn(async () => {
      calls += 1;
      return { token: `syn-token-${calls}`, expiresAtMs: T + 300_000 };
    });
    const cache = createOxygenTokenCache({ login, now: () => currentTime });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(1);

    currentTime = T + 239_999;
    const hit = await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(hit.token).toBe('syn-token-1');
    expect(login).toHaveBeenCalledTimes(1);

    currentTime = T + 240_000;
    const miss = await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(miss.token).toBe('syn-token-2');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('honors a custom skew: hit at T+289999, miss at T+290000', async () => {
    let currentTime = T;
    const login = vi.fn(async () => ({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    }));
    const cache = createOxygenTokenCache({
      login,
      now: () => currentTime,
      expirySkewMs: 10_000,
    });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    currentTime = T + 289_999;
    await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(1);

    currentTime = T + 290_000;
    await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('clamps sub-skew lifetimes: 30s token usable, boundary at T+15000', async () => {
    let currentTime = T;
    const login = vi.fn(async () => ({
      token: 'syn-token-short',
      expiresAtMs: T + 30_000,
    }));
    const cache = createOxygenTokenCache({ login, now: () => currentTime });

    const immediate = await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(immediate.token).toBe('syn-token-short');

    currentTime = T + 14_999;
    await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(1);

    currentTime = T + 15_000;
    await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('singleflights concurrent same-key calls into one login', async () => {
    const gate = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi.fn(() => gate.promise);
    const cache = createOxygenTokenCache({ login, now: () => T });

    const p1 = cache.getToken(KEY_A, { secret: SECRET_1 });
    const p2 = cache.getToken(KEY_A, { secret: SECRET_1 });
    const p3 = cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(1);

    gate.resolve({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toEqual({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('resolves per-awaiter copies so one caller cannot mutate another', async () => {
    const gate = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi.fn(() => gate.promise);
    const cache = createOxygenTokenCache({ login, now: () => T });

    const p1 = cache.getToken(KEY_A, { secret: SECRET_1 });
    const p2 = cache.getToken(KEY_A, { secret: SECRET_1 });
    gate.resolve({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    const [r1, r2] = await Promise.all([p1, p2]);

    (r1 as { token: string }).token = 'mutated';
    expect(r2.token).toBe('syn-token-aaa');
  });

  it.each([
    [Number.NaN],
    [-1],
    [Number.POSITIVE_INFINITY],
    ['60000'],
  ])('rejects a non-finite or negative expirySkewMs (%s) at construction', (expirySkewMs) => {
    const login = vi.fn();

    expect(() =>
      createOxygenTokenCache({
        login,
        now: () => T,
        expirySkewMs: expirySkewMs as unknown as number,
      })
    ).toThrow('Invalid Oxygen token cache configuration.');
    expect(login).not.toHaveBeenCalled();
  });

  it('proceeds with independent keys while another key is in flight', async () => {
    const gateA = deferred<{ token: string; expiresAtMs: number }>();
    const gateB = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi.fn((key: { accountLabel: string }) =>
      key.accountLabel === KEY_A.accountLabel ? gateA.promise : gateB.promise
    );
    const cache = createOxygenTokenCache({ login, now: () => T });

    const pA = cache.getToken(KEY_A, { secret: SECRET_1 });
    const pB = cache.getToken(KEY_B, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(2);

    gateB.resolve({ token: 'syn-token-bbb', expiresAtMs: T + 300_000 });
    gateA.resolve({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    await expect(pA).resolves.toEqual({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    });
    await expect(pB).resolves.toEqual({
      token: 'syn-token-bbb',
      expiresAtMs: T + 300_000,
    });
  });

  it('shares one rejection across concurrent callers and clears the flight', async () => {
    const gate = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi.fn(() => gate.promise);
    const cache = createOxygenTokenCache({ login, now: () => T });

    const p1 = cache.getToken(KEY_A, { secret: SECRET_1 });
    const p2 = cache.getToken(KEY_A, { secret: SECRET_1 });
    const p3 = cache.getToken(KEY_A, { secret: SECRET_1 });

    const boom = new Error('syn-login-boom');
    gate.reject(boom);
    const settled = await Promise.allSettled([p1, p2, p3]);
    for (const outcome of settled) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBe(boom);
      }
    }

    const gate2 = deferred<{ token: string; expiresAtMs: number }>();
    login.mockImplementation(() => gate2.promise);
    const retry = cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(2);
    gate2.resolve({ token: 'syn-token-retry', expiresAtMs: T + 300_000 });
    await expect(retry).resolves.toEqual({
      token: 'syn-token-retry',
      expiresAtMs: T + 300_000,
    });
  });

  it('clears the flight when login throws synchronously', async () => {
    const login = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('syn-sync-boom');
      })
      .mockImplementation(async () => ({
        token: 'syn-token-aaa',
        expiresAtMs: T + 300_000,
      }));
    const cache = createOxygenTokenCache({ login, now: () => T });

    await expect(cache.getToken(KEY_A, { secret: SECRET_1 })).rejects.toThrow(
      'syn-sync-boom'
    );
    await expect(cache.getToken(KEY_A, { secret: SECRET_1 })).resolves.toEqual({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('never stores failed logins: the next call re-attempts', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new Error('syn-login-down'))
      .mockResolvedValue({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    const cache = createOxygenTokenCache({ login, now: () => T });

    await expect(cache.getToken(KEY_A, { secret: SECRET_1 })).rejects.toThrow(
      'syn-login-down'
    );
    await expect(cache.getToken(KEY_A, { secret: SECRET_1 })).resolves.toEqual({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    });
    expect(login).toHaveBeenCalledTimes(2);
  });
});
