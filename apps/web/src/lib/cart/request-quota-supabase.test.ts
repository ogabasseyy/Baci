import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkAnonymousCartQuota } from './quota-identity';
import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
} from './request-quota';
import { SupabaseQuotaCounterError } from './supabase-quota-error';

const mocks = vi.hoisted(() => ({
  redis: vi.fn(),
  counter: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({ getRedis: mocks.redis }));
vi.mock('./supabase-quota-counter', () => ({
  incrementSupabaseQuotaCounter: mocks.counter,
}));
beforeEach(() => {
  __resetCartQuotaStoreForTesting();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CART_QUOTA_BACKEND', 'supabase');
  vi.clearAllMocks();
  mocks.counter.mockResolvedValue({
    count: 1,
    resetTime: Date.now() + 60_000,
    degraded: false,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetCartQuotaStoreForTesting();
});
const input = {
  operation: 'bootstrap' as const,
  merchantId: 'merchant',
  subject: 'client',
};

it('normalizes deployment configuration whitespace', async () => {
  vi.stubEnv('CART_QUOTA_BACKEND', ' supabase ');
  expect((await checkCartQuota(input)).allowed).toBe(true);
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('rejects an invalid backend configuration rather than silently using Redis', async () => {
  vi.stubEnv('CART_QUOTA_BACKEND', 'supabse');
  await expect(checkCartQuota(input)).rejects.toThrow(
    'Invalid cart quota backend'
  );
  expect(mocks.redis).not.toHaveBeenCalled();
  expect(mocks.counter).not.toHaveBeenCalled();
});

it('uses the shared database backend without contacting exhausted Redis', async () => {
  expect((await checkCartQuota(input)).allowed).toBe(true);
  expect(mocks.counter).toHaveBeenCalledWith(
    expect.stringContaining('bootstrap:merchant:'),
    3_600_000,
    750
  );
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('keeps the existing limit when the database reports exhaustion', async () => {
  mocks.counter.mockResolvedValue({
    count: 121,
    resetTime: Date.now() + 60_000,
    degraded: false,
  });
  expect(await checkCartQuota(input)).toMatchObject({
    allowed: false,
    limit: 120,
    remaining: 0,
  });
});

it('fails closed for creation when the database is unavailable without switching durable stores', async () => {
  mocks.counter.mockRejectedValue(new Error('RPC unavailable'));
  expect(await checkCartQuota({ ...input, operation: 'create' })).toMatchObject(
    { allowed: false, remaining: 0 }
  );
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('keeps bootstrap available with a reduced per-instance budget during a database outage', async () => {
  mocks.counter.mockRejectedValue(new Error('RPC unavailable'));
  for (let attempt = 0; attempt < 20; attempt++) {
    expect(await checkCartQuota(input)).toMatchObject({
      allowed: true,
      degraded: true,
      limit: 20,
    });
  }
  expect(await checkCartQuota(input)).toMatchObject({
    allowed: false,
    degraded: true,
    limit: 20,
  });
  expect(mocks.redis).not.toHaveBeenCalled();
});

it.each([
  ['account_link', false],
  ['bootstrap', true],
  ['bootstrap_network_backstop', true],
  ['create', false],
  ['create_network_backstop', false],
  ['commands', true],
  ['snapshot', true],
  ['handoff_issue', false],
  ['handoff_redeem', false],
  ['handoff_preview', false],
  ['handoff_preview_network_backstop', false],
  ['legacy_bridge', false],
  ['session_revoke', false],
  ['checkout_prepare', true],
] as const)('preserves the %s degradation policy when Supabase is unavailable', async (operation, allowed) => {
  mocks.counter.mockRejectedValue(new Error('RPC unavailable'));
  expect(await checkCartQuota({ ...input, operation })).toMatchObject({
    allowed,
    degraded: true,
  });
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('treats a blank backend setting as the default Redis backend', async () => {
  vi.stubEnv('CART_QUOTA_BACKEND', '   ');
  const result = await checkCartQuota(input);
  expect(result).toMatchObject({ allowed: true, degraded: true, limit: 20 });
  expect(mocks.counter).not.toHaveBeenCalled();
  expect(mocks.redis).toHaveBeenCalled();
});

it('does not repeat a failed shared counter within the same bootstrap request', async () => {
  const context = { remainingMs: 750, degraded: false };
  mocks.counter.mockRejectedValue(new Error('RPC unavailable'));
  expect(await checkCartQuota(input, context)).toMatchObject({
    allowed: true,
    degraded: true,
  });
  expect(
    await checkCartQuota({ ...input, merchantId: 'another' }, context)
  ).toMatchObject({ allowed: true, degraded: true });
  expect(mocks.counter).toHaveBeenCalledTimes(1);
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('does not retry a timed-out increment that may commit later', async () => {
  vi.useFakeTimers();
  let lateCommits = 0;
  mocks.counter.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        setTimeout(() => reject(new SupabaseQuotaCounterError('timeout')), 10);
        setTimeout(() => {
          lateCommits += 1;
        }, 50);
      })
  );
  try {
    const context = { remainingMs: 750, degraded: false };
    const first = checkCartQuota(input, context);
    await vi.advanceTimersByTimeAsync(10);
    expect(await first).toMatchObject({ allowed: true, degraded: true });
    expect(
      await checkCartQuota({ ...input, merchantId: 'another' }, context)
    ).toMatchObject({ allowed: true, degraded: true });
    await vi.advanceTimersByTimeAsync(40);
    expect(lateCommits).toBe(1);
    expect(mocks.counter).toHaveBeenCalledTimes(1);
    expect(mocks.redis).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('shares the remaining quota deadline across checks in one request', async () => {
  const clock = vi.spyOn(Date, 'now');
  let now = 1_000_000;
  clock.mockImplementation(() => now);
  const context = { remainingMs: 750, degraded: false };
  mocks.counter.mockImplementation(async () => {
    now += 300;
    return { count: 1, resetTime: now + 60_000, degraded: false };
  });
  try {
    await checkCartQuota(input, context);
    await checkCartQuota({ ...input, merchantId: 'another' }, context);
    expect(mocks.counter.mock.calls[0]?.[2]).toBe(750);
    expect(mocks.counter.mock.calls[1]?.[2]).toBe(450);
  } finally {
    clock.mockRestore();
  }
});

it('keeps a network bound when the credential counter fails after a healthy backstop', async () => {
  vi.stubEnv('VERCEL', '1');
  mocks.counter.mockImplementation(async (key: string) => {
    if (key.includes('bootstrap_network_backstop')) {
      return { count: 1, resetTime: Date.now() + 60_000, degraded: false };
    }
    throw new Error('credential counter unavailable');
  });
  let allowed = true;
  for (let attempt = 0; attempt < 21; attempt++) {
    const credential = `00000000-0000-4000-8000-${attempt.toString(16).padStart(12, '0')}`;
    const request = new NextRequest('https://example.com/cart', {
      headers: {
        'x-real-ip': '192.0.2.12',
        'x-baci-client-credential': credential,
      },
    });
    const result = await checkAnonymousCartQuota(request, {
      merchantId: 'merchant',
      operation: 'bootstrap',
    });
    allowed = result.allowed;
  }
  expect(allowed).toBe(false);
});

it('reports only the allowlisted degradation reason', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.counter.mockRejectedValue(
    new SupabaseQuotaCounterError('invalid_response')
  );
  try {
    await checkCartQuota({
      ...input,
      operation: 'create',
      subject: 'private-value',
    });
    expect(warn).toHaveBeenCalledWith('Cart quota store degraded', {
      backend: 'supabase',
      reason: 'invalid_response',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-value');
  } finally {
    warn.mockRestore();
  }
});
