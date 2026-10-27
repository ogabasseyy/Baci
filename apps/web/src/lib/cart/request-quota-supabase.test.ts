import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
} from './request-quota';

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
    3_600_000
  );
  expect(mocks.redis).not.toHaveBeenCalled();
});

it('keeps the existing limit when the database reports exhaustion', async () => {
  mocks.counter.mockResolvedValue({
    count: 31,
    resetTime: Date.now() + 60_000,
    degraded: false,
  });
  expect(await checkCartQuota(input)).toMatchObject({
    allowed: false,
    limit: 30,
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
