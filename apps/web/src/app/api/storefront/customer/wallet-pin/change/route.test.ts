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

const secret = createHash('sha256').update('s5s-change-pepper').digest('hex');
const salt = createHash('sha256')
  .update('s5s-change-salt')
  .digest('hex')
  .slice(0, 32);
const merchantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const setState = { status: 'set', kdfVersion: 1, salt, attemptsRemaining: 5 };

function call(body: unknown) {
  return handler(
    new NextRequest(
      'https://example.com/api/storefront/customer/wallet-pin/change',
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
const body = { currentPin: '482915', newPin: '730184' };

it('changes the PIN', async () => {
  answers({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'changed' },
  });
  const res = await call(body);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith(
    'change_wallet_pin',
    expect.objectContaining({ p_merchant_id: merchantId })
  );
});

it('reports a wrong current PIN with the attempts left', async () => {
  answers({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'incorrect', attemptsRemaining: 2 },
  });
  const res = await call(body);
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({
    error: 'That PIN is not right.',
    code: 'PIN_INCORRECT',
    attemptsRemaining: 2,
  });
});

it('reports a lockout from the database or the state check', async () => {
  const lockedUntil = '2026-11-03T12:30:00Z';
  answers({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'locked', lockedUntil },
  });
  let res = await call(body);
  expect(res.status).toBe(423);
  expect(await res.json()).toMatchObject({ code: 'PIN_LOCKED', lockedUntil });
  mocks.rpc.mockClear();
  answers({ get_wallet_pin_state: { status: 'locked', lockedUntil } });
  res = await call(body);
  expect(res.status).toBe(423);
  expect(mocks.rpc).not.toHaveBeenCalledWith(
    'change_wallet_pin',
    expect.anything()
  );
});

it('maps states that cannot change', async () => {
  answers({ get_wallet_pin_state: { status: 'not_set' } });
  expect((await call(body)).status).toBe(409);
  answers({ get_wallet_pin_state: { status: 'reset_required' } });
  const res = await call(body);
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('PIN_RESET_REQUIRED');
});

it('needs both PINs', async () => {
  expect((await call({ currentPin: '482915' })).status).toBe(400);
  expect((await call({ newPin: '730184' })).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('never echoes either PIN', async () => {
  answers({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'incorrect', attemptsRemaining: 1 },
  });
  const text = await (await call(body)).text();
  expect(text).not.toMatch(/482915|730184/);
});
