// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as goalVerify } from '@/app/api/storefront/customer/savings/goal-pin/verify/route';
import { POST as changeRoute } from '@/app/api/storefront/customer/wallet-pin/change/route';
import { POST as setRoute } from '@/app/api/storefront/customer/wallet-pin/set/route';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  identity: vi.fn(),
  tenant: vi.fn(),
  rpc: vi.fn(),
  verify: vi.fn(),
  owned: vi.fn(),
  issued: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: async (...args: unknown[]) => ({
    verdict: await mocks.tenant(...args),
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: () => ({
    onboarding: { merchantId: merchantA },
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRuntime: () => ({
    merchantId: merchantA,
    businessId: 'b',
    configuration: { integrationId: 'i', environment: 'sandbox' },
  }),
  readPrimaryWalletSavingsRecoveryRuntime: () => ({
    merchantId: merchantA,
    businessId: 'b',
    configuration: { integrationId: 'i', environment: 'sandbox' },
  }),
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/goal-pin-verify', () => ({
  verifyGoalPin: mocks.verify,
}));
vi.mock('@/lib/piggyvest/goal-pin-fund-eligibility', () => ({
  isActiveOwnGoal: mocks.owned,
  isCancellableOwnGoal: mocks.owned,
  isCompletableOwnGoal: mocks.owned,
}));
vi.mock('@/lib/piggyvest/goal-cancel-runtime', () => ({
  isPrimaryWalletGoalCancelIssued: mocks.issued,
}));
vi.mock(
  '@/app/api/storefront/customer/savings/customer-savings-feature-settings',
  () => ({
    getPrimaryCustomerSavingsFeatureSettings: async () => ({
      savingsEnabled: false,
    }),
  })
);

const merchantA = '11111111-1111-4111-8111-111111111111';
const alice = '22222222-2222-4222-8222-222222222222';
const bob = '44444444-4444-4444-8444-444444444444';
const goalId = '55555555-5555-4555-8555-555555555555';

// Stateful stand-in for the Redis sliding window: counts per namespace + key.
const counts = new Map<string, number>();
let redisDown = false;

function post(path: string, body: unknown) {
  return new NextRequest(
    `https://example.com/api/storefront/customer/${path}`,
    {
      method: 'POST',
      // Every caller shares one carrier IP.
      headers: { 'x-forwarded-for': '203.0.113.7' },
      body: JSON.stringify(body),
    }
  );
}
const asCustomer = (userId: string) =>
  mocks.identity.mockResolvedValue({
    userId,
    customerId: `c-${userId}`,
    merchantId: merchantA,
  });
const setBody = { pin: '482915' };
const changeBody = { currentPin: '482915', newPin: '739104' };

beforeEach(() => {
  vi.clearAllMocks();
  counts.clear();
  redisDown = false;
  mocks.auth.mockResolvedValue({
    error: null,
    user: { id: 'u' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
  mocks.owned.mockResolvedValue(true);
  mocks.issued.mockResolvedValue(true);
  mocks.verify.mockResolvedValue({ status: 'not_set' });
  mocks.tenant.mockImplementation(
    async (ns: string, key: string, cfg: { maxRequests: number }) => {
      if (redisDown) return 'unavailable';
      const id = `${ns}|${key}`;
      const n = (counts.get(id) ?? 0) + 1;
      counts.set(id, n);
      return n > cfg.maxRequests ? 'denied' : 'allowed';
    }
  );
});

describe('per-customer wallet-PIN limiter on the routes', () => {
  it('throttles one customer after five mutations', async () => {
    asCustomer(alice);
    for (let i = 0; i < 5; i++)
      expect((await setRoute(post('wallet-pin/set', setBody))).status).not.toBe(
        429
      );
    const sixth = await setRoute(post('wallet-pin/set', setBody));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBe('600');
    expect((await sixth.json()).code).toBe('RATE_LIMITED');
  });

  it('counts two customers behind one IP separately', async () => {
    asCustomer(alice);
    for (let i = 0; i < 6; i++) await setRoute(post('wallet-pin/set', setBody));
    asCustomer(bob);
    const response = await setRoute(post('wallet-pin/set', setBody));
    expect(response.status).not.toBe(429);
  });

  it('gives change its own budget of three', async () => {
    asCustomer(alice);
    for (let i = 0; i < 3; i++)
      expect(
        (await changeRoute(post('wallet-pin/change', changeBody))).status
      ).not.toBe(429);
    expect(
      (await changeRoute(post('wallet-pin/change', changeBody))).status
    ).toBe(429);
    // The set/reset budget is untouched by change attempts.
    expect((await setRoute(post('wallet-pin/set', setBody))).status).not.toBe(
      429
    );
  });

  it('does not charge invalid input', async () => {
    asCustomer(alice);
    for (let i = 0; i < 8; i++) await setRoute(post('wallet-pin/set', {}));
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it('does not charge unauthenticated callers', async () => {
    mocks.auth.mockResolvedValue({ error: 'x', user: null, supabase: null });
    expect((await setRoute(post('wallet-pin/set', setBody))).status).toBe(401);
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it('fails closed when Redis is down', async () => {
    asCustomer(alice);
    redisDown = true;
    const response = await setRoute(post('wallet-pin/set', setBody));
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMITED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  const goalBody = {
    merchantId: merchantA,
    pin: '482915',
    action: 'cancel',
    goalId,
    operationId: goalId,
  };

  it('limits goal-pin verify per customer once PIN checks are reached', async () => {
    asCustomer(alice);
    for (let i = 0; i < 5; i++)
      expect(
        (await goalVerify(post('savings/goal-pin/verify', goalBody))).status
      ).toBe(409);
    expect(mocks.verify).toHaveBeenCalledTimes(5);
    const response = await goalVerify(
      post('savings/goal-pin/verify', goalBody)
    );
    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe('RATE_LIMITED');
    expect(mocks.verify).toHaveBeenCalledTimes(5);
  });

  it('does not charge goal-pin requests that never reach a PIN check', async () => {
    asCustomer(alice);
    mocks.owned.mockResolvedValue(false);
    for (let i = 0; i < 8; i++)
      expect(
        (await goalVerify(post('savings/goal-pin/verify', goalBody))).status
      ).toBe(404);
    mocks.owned.mockResolvedValue(true);
    mocks.issued.mockResolvedValue(false);
    for (let i = 0; i < 8; i++)
      expect(
        (await goalVerify(post('savings/goal-pin/verify', goalBody))).status
      ).toBe(409);
    expect(mocks.tenant).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});
