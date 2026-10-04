import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter, resolveClientIp } from './rate-limit';

describe('createRateLimiter', () => {
  it('bounds cleanup work when more than 20,000 counters remain live', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 2,
      maxPerIp: 2,
    });
    for (let index = 0; index < 10_001; index += 1) {
      limiter.check({ keyId: `key-${index}`, ip: `ip-${index}` }, 0);
    }
    const originalIterator = Map.prototype[Symbol.iterator];
    let visited = 0;
    const spy = vi
      .spyOn(Map.prototype, Symbol.iterator)
      .mockImplementation(function (this: Map<string, unknown>) {
        const iterator = originalIterator.call(this);
        return {
          next: () => {
            visited += 1;
            return iterator.next();
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      });
    try {
      expect(limiter.check({ keyId: 'key-0', ip: 'ip-0' }, 1).allowed).toBe(
        true
      );
      expect(visited).toBeLessThanOrEqual(256);
      expect(limiter.check({ keyId: 'key-0', ip: 'ip-0' }, 2).allowed).toBe(
        false
      );
      expect(
        limiter.check({ keyId: 'key-0', ip: 'ip-0' }, 60_001).allowed
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it('allows calls under both budgets', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 2,
      maxPerIp: 3,
    });
    expect(limiter.check({ keyId: 'a', ip: '10.0.0.1' }, 0)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      limitedBy: null,
    });
    expect(limiter.check({ keyId: 'a', ip: '10.0.0.1' }, 1)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      limitedBy: null,
    });
  });

  it('trips the per-key budget without starving other keys', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 2,
      maxPerIp: 100,
    });
    limiter.check({ keyId: 'hot', ip: '10.0.0.1' }, 0);
    limiter.check({ keyId: 'hot', ip: '10.0.0.1' }, 1);
    const limited = limiter.check({ keyId: 'hot', ip: '10.0.0.1' }, 2);
    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check({ keyId: 'cold', ip: '10.0.0.2' }, 3).allowed).toBe(
      true
    );
  });

  it('trips the per-IP budget across keys and resets after the window', () => {
    const limiter = createRateLimiter({
      windowMs: 1000,
      maxPerKey: 100,
      maxPerIp: 2,
    });
    limiter.check({ keyId: 'a', ip: '10.0.0.9' }, 0);
    limiter.check({ keyId: 'b', ip: '10.0.0.9' }, 1);
    expect(limiter.check({ keyId: 'c', ip: '10.0.0.9' }, 2).allowed).toBe(
      false
    );
    expect(limiter.check({ keyId: 'c', ip: '10.0.0.9' }, 1001).allowed).toBe(
      true
    );
  });

  it('does not advance key counters on IP-denied requests', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 1,
      maxPerIp: 1,
    });
    limiter.check({ keyId: null, ip: '10.0.0.5' }, 0);
    // Denied by IP: the key counter must stay untouched, so the same
    // key from a fresh IP still gets its full budget.
    expect(limiter.check({ keyId: 'k', ip: '10.0.0.5' }, 1).allowed).toBe(
      false
    );
    expect(limiter.check({ keyId: 'k', ip: '10.0.0.6' }, 2).allowed).toBe(true);
  });

  it('uses forwarded client addresses only behind a trusted proxy', () => {
    const trusted = ['127.0.0.1', '::1'];
    expect(
      resolveClientIp({
        socketAddress: '127.0.0.1',
        forwardedFor: '198.51.100.7, 127.0.0.1',
        trustedProxies: trusted,
      })
    ).toBe('198.51.100.7');
    expect(
      resolveClientIp({
        socketAddress: '127.0.0.1',
        forwardedFor: undefined,
        trustedProxies: trusted,
      })
    ).toBe('127.0.0.1');
    expect(
      resolveClientIp({
        socketAddress: '203.0.113.9',
        forwardedFor: '198.51.100.7',
        trustedProxies: trusted,
      })
    ).toBe('203.0.113.9');
    expect(
      resolveClientIp({
        socketAddress: '::ffff:127.0.0.1',
        forwardedFor: '198.51.100.8',
        trustedProxies: trusted,
      })
    ).toBe('198.51.100.8');
  });

  it('reports which budget denied the request', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 1,
      maxPerIp: 2,
    });
    expect(limiter.check({ keyId: 'k', ip: '10.0.0.1' }, 0)).toMatchObject({
      allowed: true,
      limitedBy: null,
    });
    expect(limiter.check({ keyId: 'k', ip: '10.0.0.1' }, 1)).toMatchObject({
      allowed: false,
      limitedBy: 'key',
    });
    expect(limiter.check({ keyId: null, ip: '10.0.0.1' }, 2)).toMatchObject({
      allowed: false,
      limitedBy: 'ip',
    });
  });

  it('limits key-less routes by IP only', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxPerKey: 1,
      maxPerIp: 2,
    });
    limiter.check({ keyId: null, ip: '10.0.0.7' }, 0);
    limiter.check({ keyId: null, ip: '10.0.0.7' }, 1);
    expect(limiter.check({ keyId: null, ip: '10.0.0.7' }, 2).allowed).toBe(
      false
    );
  });
});

it('rejects new identities at capacity and recovers after expiry', () => {
  const limiter = createRateLimiter({
    windowMs: 1000,
    maxPerKey: 10,
    maxPerIp: 10,
    maxIdentities: 2,
  });
  expect(limiter.check({ ip: 'a', keyId: 'a' }, 0).allowed).toBe(true);
  expect(limiter.check({ ip: 'b', keyId: 'b' }, 0).allowed).toBe(true);
  expect(limiter.check({ ip: 'c', keyId: 'c' }, 1)).toMatchObject({
    allowed: false,
    limitedBy: 'ip',
  });
  expect(limiter.check({ ip: 'a', keyId: 'c' }, 1)).toMatchObject({
    allowed: false,
    limitedBy: 'key',
  });
  expect(limiter.check({ ip: 'a', keyId: 'a' }, 2).allowed).toBe(true);
  expect(limiter.check({ ip: 'c', keyId: 'c' }, 1001).allowed).toBe(true);
});
