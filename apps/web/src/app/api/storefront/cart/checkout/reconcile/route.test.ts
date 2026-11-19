import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const sessionId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const mocks = vi.hoisted(() => ({
  csrf: vi.fn(),
  auth: vi.fn(),
  resolveMerchant: vi.fn(),
  resolveProof: vi.fn(),
  quota: vi.fn(),
  rpc: vi.fn(),
  summary: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.csrf,
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/cart/request-context', () => ({
  resolveCartMerchant: mocks.resolveMerchant,
  readCartJsonBody: async (request: Request) => ({
    ok: true,
    body: await request.json(),
  }),
  checkCartQuota: mocks.quota,
}));
vi.mock('@/lib/cart/checkout-reconciliation-proof', () => ({
  resolveCheckoutReconciliationAuthority: mocks.resolveProof,
}));
vi.mock('@/lib/cart/checkout-reconciliation-client', () => ({
  createCheckoutReconciliationClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/checkout/get-redvault-checkout-summary', () => ({
  getRedvaultCheckoutSummary: mocks.summary,
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));

function request(overrides: Record<string, unknown> = {}) {
  return new NextRequest(
    'https://store.example/api/storefront/cart/checkout/reconcile',
    {
      method: 'POST',
      body: JSON.stringify({
        cartId,
        sessionId,
        generation: 1,
        cartVersion: 1,
        customerEmail: 'ada@example.test',
        idempotencyKey: 'attempt-key',
        ...overrides,
      }),
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.auth.mockResolvedValue({
    user: { id: userId },
    error: null,
    supabase: {},
  });
  mocks.resolveMerchant.mockResolvedValue({
    ok: true,
    merchant: { id: merchantId, slug: 'store' },
  });
  mocks.resolveProof.mockReturnValue({
    ok: true,
    authority: { session: { principalId: 'shopper-1' } },
  });
  mocks.quota.mockResolvedValue({ allowed: true });
  mocks.rpc.mockResolvedValue({
    data: {
      kind: 'retired',
      cartId,
      checkoutSessionId: sessionId,
      checkoutGeneration: 1,
    },
    error: null,
  });
});

it('rejects invalid CSRF before the authentication lookup on this guest-capable route', async () => {
  mocks.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('allows a verified guest only when the cart proof is valid', async () => {
  mocks.auth.mockResolvedValue({
    user: null,
    error: 'Not authenticated',
    supabase: null,
  });
  expect((await POST(request())).status).toBe(200);
  expect(mocks.resolveProof).toHaveBeenCalledWith(
    expect.any(NextRequest),
    expect.objectContaining({ userId: null })
  );
  mocks.resolveProof.mockReturnValueOnce({ ok: false });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.rpc).toHaveBeenCalledOnce();
});

it('rejects malformed input and denied quota before invoking recovery', async () => {
  expect((await POST(request({ sessionId: 'not-a-uuid' }))).status).toBe(400);
  mocks.quota.mockResolvedValueOnce({ allowed: false });
  expect((await POST(request())).status).toBe(429);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('confirms retirement of the same checkout without starting an order', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: 'retired',
    cartId,
    checkoutSessionId: sessionId,
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mocks.summary).not.toHaveBeenCalled();
});

it('does not reconcile when authentication is indeterminate or the proof is invalid', async () => {
  mocks.auth.mockResolvedValueOnce({
    user: null,
    error: 'Authentication failed',
    supabase: null,
  });
  expect((await POST(request())).status).toBe(503);
  mocks.resolveProof.mockReturnValueOnce({ ok: false });
  expect((await POST(request())).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it('rejects a mismatched retirement receipt', async () => {
  mocks.rpc.mockResolvedValueOnce({
    data: {
      kind: 'retired',
      cartId,
      checkoutSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      checkoutGeneration: 1,
    },
    error: null,
  });
  expect((await POST(request())).status).toBe(503);
});

it('restores the authoritative unpaid UBA order when the server reports one was submitted', async () => {
  const orderId = '66666666-6666-4666-8666-666666666666';
  mocks.rpc.mockResolvedValueOnce({
    data: { kind: 'submitted', orderId },
    error: null,
  });
  mocks.summary.mockResolvedValueOnce({
    order: {
      id: orderId,
      total: 102.5,
      currency: 'NGN',
      tracking_token: 'proof',
      payment_status: 'unpaid',
    },
    quote: { payable_kobo: 10250, shipping_kobo: 0 },
  });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    kind: 'submitted',
    order: { id: orderId },
    redvault: { quote: { payable_kobo: 10250 } },
  });
});

it('does not restore a review if the order was paid after reconciliation', async () => {
  const orderId = '66666666-6666-4666-8666-666666666666';
  mocks.rpc.mockResolvedValueOnce({
    data: { kind: 'submitted', orderId },
    error: null,
  });
  mocks.summary.mockResolvedValueOnce({
    order: { id: orderId, payment_status: 'paid' },
    quote: { payable_kobo: 10250 },
  });
  expect((await POST(request())).status).toBe(503);
});
