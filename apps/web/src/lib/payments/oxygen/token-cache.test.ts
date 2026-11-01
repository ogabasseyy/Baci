import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenTokenCache, OxygenTokenCacheError } from './token-cache';

// Synthetic fixtures only; no real provider material.
const T = 1_786_000_000_000;
const KEY_A = { accountLabel: 'syn-acct-checking', environment: 'syn-sandbox' };
const KEY_B = { accountLabel: 'syn-acct-savings', environment: 'syn-sandbox' };
const KEY_C = {
  accountLabel: 'syn-acct-checking',
  environment: 'syn-prodlike',
};
const SECRET_1 = 'syn-cache-secret-aaa1';
const SECRET_2 = 'syn-cache-secret-bbb2';

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

  it('invalidate drops the entry so the next call re-logs in', async () => {
    let calls = 0;
    const login = vi.fn(async () => {
      calls += 1;
      return { token: `syn-token-${calls}`, expiresAtMs: T + 300_000 };
    });
    const cache = createOxygenTokenCache({ login, now: () => T });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    cache.invalidate(KEY_A);
    const after = await cache.getToken(KEY_A, { secret: SECRET_1 });

    expect(after.token).toBe('syn-token-2');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('invalidate is idempotent on absent keys', () => {
    const login = vi.fn();
    const cache = createOxygenTokenCache({ login, now: () => T });

    expect(() => {
      cache.invalidate(KEY_A);
      cache.invalidate(KEY_A);
    }).not.toThrow();
    expect(login).not.toHaveBeenCalled();
  });

  it('invalidate detaches the flight: prior awaiters resolve, newcomers re-login', async () => {
    const gate1 = deferred<{ token: string; expiresAtMs: number }>();
    const gate2 = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi
      .fn()
      .mockImplementationOnce(() => gate1.promise)
      .mockImplementationOnce(() => gate2.promise);
    const cache = createOxygenTokenCache({ login, now: () => T });

    const prior = cache.getToken(KEY_A, { secret: SECRET_1 });
    cache.invalidate(KEY_A);
    const newcomer = cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(2);

    gate1.resolve({ token: 'syn-token-first', expiresAtMs: T + 300_000 });
    gate2.resolve({ token: 'syn-token-second', expiresAtMs: T + 300_000 });
    await expect(prior).resolves.toEqual({
      token: 'syn-token-first',
      expiresAtMs: T + 300_000,
    });
    await expect(newcomer).resolves.toEqual({
      token: 'syn-token-second',
      expiresAtMs: T + 300_000,
    });
    // The detached first resolution must not overwrite the second login.
    const current = await cache.getToken(KEY_A, { secret: SECRET_1 });
    expect(current.token).toBe('syn-token-second');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('isolates keys: resolving one deferred never settles another', async () => {
    const gateA = deferred<{ token: string; expiresAtMs: number }>();
    const gateB = deferred<{ token: string; expiresAtMs: number }>();
    const login = vi.fn((key: { accountLabel: string }) =>
      key.accountLabel === KEY_A.accountLabel ? gateA.promise : gateB.promise
    );
    const cache = createOxygenTokenCache({ login, now: () => T });

    const pA = cache.getToken(KEY_A, { secret: SECRET_1 });
    let bSettled = false;
    const pB = cache.getToken(KEY_B, { secret: SECRET_1 }).then(
      (value) => {
        bSettled = true;
        return value;
      },
      (error: unknown) => {
        bSettled = true;
        throw error;
      }
    );

    gateA.resolve({ token: 'syn-token-aaa', expiresAtMs: T + 300_000 });
    await expect(pA).resolves.toEqual({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(bSettled).toBe(false);

    gateB.resolve({ token: 'syn-token-bbb', expiresAtMs: T + 300_000 });
    await expect(pB).resolves.toEqual({
      token: 'syn-token-bbb',
      expiresAtMs: T + 300_000,
    });
  });

  it('never returns a token stored under a different key', async () => {
    const login = vi.fn(
      async (key: { accountLabel: string; environment: string }) => ({
        token: `syn-token-${key.accountLabel}-${key.environment}`,
        expiresAtMs: T + 300_000,
      })
    );
    const cache = createOxygenTokenCache({ login, now: () => T });

    const a = await cache.getToken(KEY_A, { secret: SECRET_1 });
    const b = await cache.getToken(KEY_B, { secret: SECRET_1 });
    const c = await cache.getToken(KEY_C, { secret: SECRET_1 });

    expect(a.token).toBe(
      `syn-token-${KEY_A.accountLabel}-${KEY_A.environment}`
    );
    expect(b.token).toBe(
      `syn-token-${KEY_B.accountLabel}-${KEY_B.environment}`
    );
    expect(c.token).toBe(
      `syn-token-${KEY_C.accountLabel}-${KEY_C.environment}`
    );
    expect(new Set([a.token, b.token, c.token]).size).toBe(3);
    // Repeat reads stay isolated without new logins.
    await cache.getToken(KEY_A, { secret: SECRET_1 });
    await cache.getToken(KEY_B, { secret: SECRET_1 });
    expect(login).toHaveBeenCalledTimes(3);
  });

  it('treats key comparison as exact: case and whitespace are significant', async () => {
    const login = vi.fn(async () => ({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    }));
    const cache = createOxygenTokenCache({ login, now: () => T });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    await cache.getToken(
      { accountLabel: 'SYN-ACCT-CHECKING', environment: KEY_A.environment },
      { secret: SECRET_1 }
    );
    await cache.getToken(
      {
        accountLabel: `${KEY_A.accountLabel} `,
        environment: KEY_A.environment,
      },
      { secret: SECRET_1 }
    );

    expect(login).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['empty accountLabel', { accountLabel: '', environment: 'syn-sandbox' }],
    [
      'whitespace accountLabel',
      { accountLabel: '   ', environment: 'syn-sandbox' },
    ],
    ['empty environment', { accountLabel: 'syn-acct', environment: '' }],
    ['whitespace environment', { accountLabel: 'syn-acct', environment: '  ' }],
    ['null key', null],
    ['null accountLabel', { accountLabel: null, environment: 'syn-sandbox' }],
    ['numeric environment', { accountLabel: 'syn-acct', environment: 7 }],
  ])('rejects an invalid key (%s) without calling login', async (_label, key) => {
    const login = vi.fn();
    const cache = createOxygenTokenCache({ login, now: () => T });

    const error = await cache.getToken(key as never, { secret: SECRET_1 }).then(
      () => {
        throw new Error('expected getToken to reject');
      },
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(OxygenTokenCacheError);
    expect((error as OxygenTokenCacheError).code).toBe('invalid_key');
    expect(login).not.toHaveBeenCalled();
    expect(() => cache.invalidate(key as never)).toThrow(OxygenTokenCacheError);
  });

  it('pins the rotation assumption: cached token survives a secret change until invalidate', async () => {
    const login = vi.fn(async () => ({
      token: 'syn-token-aaa',
      expiresAtMs: T + 300_000,
    }));
    const cache = createOxygenTokenCache({ login, now: () => T });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    const rotated = await cache.getToken(KEY_A, { secret: SECRET_2 });
    expect(rotated.token).toBe('syn-token-aaa');
    expect(login).toHaveBeenCalledTimes(1);

    cache.invalidate(KEY_A);
    await cache.getToken(KEY_A, { secret: SECRET_2 });
    expect(login).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenLastCalledWith(KEY_A, { secret: SECRET_2 });
  });

  it('never logs across success and failure modes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const login = vi
      .fn()
      .mockResolvedValueOnce({
        token: 'syn-token-aaa',
        expiresAtMs: T + 300_000,
      })
      .mockRejectedValueOnce(new Error('syn-login-down'));
    const cache = createOxygenTokenCache({ login, now: () => T });

    await cache.getToken(KEY_A, { secret: SECRET_1 });
    cache.invalidate(KEY_A);
    await cache.getToken(KEY_A, { secret: SECRET_1 }).then(
      () => {},
      () => {}
    );
    await cache.getToken(null as never, { secret: SECRET_1 }).then(
      () => {},
      () => {}
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('never echoes the key in invalid_key errors', async () => {
    const login = vi.fn();
    const cache = createOxygenTokenCache({ login, now: () => T });
    const key = {
      accountLabel: 'syn-distinct-label-zz9',
      environment: '   ',
    };

    const error = (await cache.getToken(key, { secret: SECRET_1 }).then(
      () => {
        throw new Error('expected getToken to reject');
      },
      (reason: unknown) => reason
    )) as OxygenTokenCacheError;

    expect(error).toBeInstanceOf(OxygenTokenCacheError);
    expect(JSON.stringify(error)).not.toContain('syn-distinct-label-zz9');
    expect(login).not.toHaveBeenCalled();
  });
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
