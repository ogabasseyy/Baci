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

const secret = createHash('sha256').update('s5s-reset-pepper').digest('hex');
const merchantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';

function call(body: unknown) {
  return handler(
    new NextRequest(
      'https://example.com/api/storefront/customer/wallet-pin/reset',
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

it('resets the PIN after a recent sign-in', async () => {
  answers({ reset_wallet_pin: { status: 'reset' } });
  const res = await call({ pin: '482915' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith(
    'reset_wallet_pin',
    expect.objectContaining({ p_merchant_id: merchantId })
  );
});

it('requires re-authentication exactly as the database demands', async () => {
  answers({ reset_wallet_pin: { status: 'reauthentication_required' } });
  const res = await call({ pin: '482915' });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('REAUTHENTICATION_REQUIRED');
});

it('maps a missing PIN and an unusable binding', async () => {
  answers({ reset_wallet_pin: { status: 'not_set' } });
  expect((await call({ pin: '482915' })).status).toBe(409);
  answers({ reset_wallet_pin: { status: 'unavailable' } });
  expect((await call({ pin: '482915' })).status).toBe(503);
});

it('rejects a reset body that tries to carry other fields', async () => {
  const res = await call({ pin: '482915', currentPin: '111111' });
  expect(res.status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
