// @vitest-environment node
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as setRoute } from '@/app/api/storefront/customer/wallet-pin/set/route';
import { GET as statusRoute } from '@/app/api/storefront/customer/wallet-pin/status/route';

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

const secret = createHash('sha256').update('s5s-route-pepper').digest('hex');
const merchantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const base = 'https://example.com/api/storefront/customer/wallet-pin';

function post(body: unknown, raw?: string) {
  return setRoute(
    new NextRequest(`${base}/set`, {
      method: 'POST',
      body: raw ?? JSON.stringify(body),
    })
  );
}
const get = () => statusRoute(new NextRequest(`${base}/status`));

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
  mocks.rpc.mockResolvedValue({ data: { status: 'set' }, error: null });
});
afterEach(() => vi.unstubAllEnvs());

it('authenticates before anything else', async () => {
  mocks.auth.mockResolvedValue({ error: 'x', user: null, supabase: null });
  for (const res of [await post({ pin: '482915' }), await get()]) {
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Please sign in again.',
      code: 'UNAUTHORIZED',
    });
  }
  expect(mocks.csrf).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('refuses a failed CSRF check before reading the body or hashing', async () => {
  mocks.csrf.mockResolvedValue({ valid: false });
  const res = await post({ pin: '482915' });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe('CSRF_FAILED');
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('normalises the shared CSRF response into the stable shape', async () => {
  // The real checkCsrfProtection always attaches its own code-less response.
  mocks.csrf.mockResolvedValue({
    valid: false,
    response: NextResponse.json(
      { error: 'Invalid CSRF token' },
      { status: 403 }
    ),
  });
  const res = await post({ pin: '482915' });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({
    error: 'Please refresh and try again.',
    code: 'CSRF_FAILED',
  });
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('leaves rate limiting to the proxy so a request is never counted twice', async () => {
  mocks.rpc.mockResolvedValue({ data: { status: 'not_set' }, error: null });
  await post({ pin: '482915' });
  await get();
  expect(mocks.limit).not.toHaveBeenCalled();
});

it('treats malformed JSON and invalid PINs as client errors', async () => {
  for (const res of [
    await post(null, '{not json'),
    await post({ pin: '12' }),
    await post({ pin: '482915', merchantId }),
    await post(null, ''),
  ]) {
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_INPUT');
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('uses the server merchant and signed-in account, never the body', async () => {
  const res = await post({ pin: '482915' });
  expect(res.status).toBe(200);
  expect(mocks.identity).toHaveBeenCalledWith(
    expect.objectContaining({ merchantId, forOnboarding: false })
  );
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_merchant_id: merchantId,
  });
});

it('answers 503 when the wallet runtime is off, the pepper is unusable, or the database fails', async () => {
  mocks.runtime.mockReturnValue(null);
  expect((await post({ pin: '482915' })).status).toBe(503);
  mocks.runtime.mockReturnValue({ onboarding: { merchantId } });
  vi.stubEnv('WALLET_PIN_PEPPER', 'short');
  const noPepper = await post({ pin: '482915' });
  expect(noPepper.status).toBe(503);
  expect((await noPepper.json()).code).toBe('PIN_UNAVAILABLE');
  vi.stubEnv('WALLET_PIN_PEPPER', secret);
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
  expect((await post({ pin: '482915' })).status).toBe(503);
  mocks.rpc.mockResolvedValue({ data: { status: 'unavailable' }, error: null });
  expect((await post({ pin: '482915' })).status).toBe(503);
});

it('asks for a verified profile when the identity cannot be resolved', async () => {
  mocks.identity.mockResolvedValue(null);
  const res = await post({ pin: '482915' });
  expect(res.status).toBe(409);
  expect((await res.json()).code).toBe('PROFILE_VERIFICATION_REQUIRED');
});

it('reports status as not primary when the wallet runtime is off', async () => {
  mocks.runtime.mockReturnValue(null);
  const res = await get();
  expect(await res.json()).toEqual({
    primary: false,
    hasPin: false,
    resetRequired: false,
    available: false,
    signInConfirmationRequired: false,
  });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('reports status for a signed-in customer', async () => {
  mocks.rpc.mockResolvedValue({
    data: { status: 'reset_required' },
    error: null,
  });
  const res = await get();
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({
    primary: true,
    hasPin: true,
    resetRequired: true,
    available: true,
    signInConfirmationRequired: false,
  });
});

it('never puts the PIN in a response or a log, success or failure', async () => {
  const pin = '482915';
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
    (level) => vi.spyOn(console, level).mockImplementation(() => undefined)
  );
  const bodies: string[] = [];
  const results = [
    { data: { status: 'set' }, error: null },
    { data: { status: 'already_set' }, error: null },
    { data: { status: 'reauthentication_required' }, error: null },
    { data: null, error: { message: `failed for ${pin}` } },
    { data: { status: 'bogus' }, error: null },
  ];
  for (const result of results) {
    mocks.rpc.mockResolvedValue(result);
    const res = await post({ pin });
    bodies.push(await res.text(), JSON.stringify([...res.headers]));
  }
  expect((await post({ pin: 'abc482915' })).status).toBe(400);
  bodies.push(await (await post({ pin: `${pin}x` })).text());
  expect(bodies.join('\n')).not.toContain(pin);
  const logged = spies.flatMap((spy) => spy.mock.calls).flat();
  expect(JSON.stringify(logged)).not.toContain(pin);
  for (const spy of spies) spy.mockRestore();
});
