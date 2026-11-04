// @vitest-environment node
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as handler } from './route';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/wallet-pin/wallet-pin-customer-limit', () => ({
  chargeWalletPinCustomerLimit: async () => null,
}));
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.limit }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));

const secret = createHash('sha256').update('s5s-set-pepper').digest('hex');
const merchantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function call(body: unknown) {
  return handler(
    new NextRequest(
      'https://example.com/api/storefront/customer/wallet-pin/set',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
  );
}
function answers(map: Record<string, unknown>) {
  mocks.rpc.mockImplementation((name: string) =>
    Promise.resolve({ data: map[name] ?? null, error: null })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WALLET_PIN_PEPPER', secret);
  mocks.auth.mockResolvedValue({
    user: { id: userId },
    supabase: { rpc: mocks.rpc },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.limit.mockResolvedValue({
    allowed: true,
    limit: 20,
    remaining: 19,
    resetTime: Date.now() + 60_000,
  });
  mocks.runtime.mockReturnValue({ onboarding: { merchantId } });
  mocks.identity.mockResolvedValue({ merchantId, customerId: 'c', userId });
});

it('sets the first PIN', async () => {
  answers({ set_wallet_pin: { status: 'set' } });
  const res = await call({ pin: '482915' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith(
    'set_wallet_pin',
    expect.objectContaining({ p_merchant_id: merchantId })
  );
});

it('refuses a second set and a stale sign-in with stable codes', async () => {
  answers({ set_wallet_pin: { status: 'already_set' } });
  const again = await call({ pin: '482915' });
  expect(again.status).toBe(409);
  expect((await again.json()).code).toBe('PIN_ALREADY_SET');
  answers({ set_wallet_pin: { status: 'reauthentication_required' } });
  const stale = await call({ pin: '482915' });
  expect(stale.status).toBe(403);
  expect((await stale.json()).code).toBe('REAUTHENTICATION_REQUIRED');
});
