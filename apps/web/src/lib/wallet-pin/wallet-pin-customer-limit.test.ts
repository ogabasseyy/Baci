// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeWalletPinCustomerLimit } from './wallet-pin-customer-limit';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ tenant: vi.fn() }));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimitDetailed: async (...args: unknown[]) => {
    const result = await mocks.tenant(...args);
    return typeof result === 'string' ? { verdict: result } : result;
  },
}));

const merchantA = '11111111-1111-4111-8111-111111111111';
const merchantB = '33333333-3333-4333-8333-333333333333';
const alice = '22222222-2222-4222-8222-222222222222';
const bob = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant.mockResolvedValue('allowed');
});

describe('chargeWalletPinCustomerLimit', () => {
  it('allows within budget and keys by merchant plus customer', async () => {
    expect(
      await chargeWalletPinCustomerLimit('mutation', merchantA, alice)
    ).toBeNull();
    expect(mocks.tenant).toHaveBeenCalledWith(
      'wallet-pin:mutation',
      `${merchantA}:${alice}`,
      { maxRequests: 5, windowMs: 600_000 }
    );
  });

  it('counts customers behind one IP separately', async () => {
    await chargeWalletPinCustomerLimit('mutation', merchantA, alice);
    await chargeWalletPinCustomerLimit('mutation', merchantA, bob);
    const keys = mocks.tenant.mock.calls.map((c) => c[1]);
    expect(new Set(keys).size).toBe(2);
  });

  it('separates the same customer across merchants', async () => {
    await chargeWalletPinCustomerLimit('mutation', merchantA, alice);
    await chargeWalletPinCustomerLimit('mutation', merchantB, alice);
    const keys = mocks.tenant.mock.calls.map((c) => c[1]);
    expect(new Set(keys).size).toBe(2);
  });

  it('throttles one customer with a stable 429 and Retry-After', async () => {
    mocks.tenant.mockResolvedValue('denied');
    const response = await chargeWalletPinCustomerLimit(
      'mutation',
      merchantA,
      alice
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('600');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(await response?.json()).toEqual({
      error: 'Too many attempts. Please try again later.',
      code: 'RATE_LIMITED',
    });
  });

  it('sends the seconds left until the limiter resets as Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    mocks.tenant.mockResolvedValue({
      verdict: 'denied',
      resetAt: 1_700_000_042_500,
    });
    const response = await chargeWalletPinCustomerLimit(
      'mutation',
      merchantA,
      alice
    );
    vi.useRealTimers();
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('43');
  });

  it('gives change-PIN its own tighter budget and bucket', async () => {
    await chargeWalletPinCustomerLimit('change', merchantA, alice);
    expect(mocks.tenant).toHaveBeenCalledWith(
      'wallet-pin:change',
      `${merchantA}:${alice}`,
      { maxRequests: 3, windowMs: 600_000 }
    );
  });

  it('gives goal-pin verify its own bucket', async () => {
    await chargeWalletPinCustomerLimit('goal-verify', merchantA, alice);
    expect(mocks.tenant.mock.calls[0][0]).toBe('wallet-pin:goal-verify');
    expect(mocks.tenant.mock.calls[0][2]).toEqual({
      maxRequests: 5,
      windowMs: 600_000,
    });
  });

  it('fails closed when Redis is unavailable', async () => {
    mocks.tenant.mockResolvedValue('unavailable');
    const response = await chargeWalletPinCustomerLimit(
      'change',
      merchantA,
      alice
    );
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('60');
    expect(await response?.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('fails closed when the limiter throws', async () => {
    mocks.tenant.mockRejectedValue(new Error('boom'));
    const response = await chargeWalletPinCustomerLimit(
      'mutation',
      merchantA,
      alice
    );
    expect(response?.status).toBe(429);
  });
});
