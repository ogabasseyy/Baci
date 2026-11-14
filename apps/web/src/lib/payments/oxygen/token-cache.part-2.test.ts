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

describe('createOxygenTokenCache', () => {
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
