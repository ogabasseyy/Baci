import type { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { getCustomerCart, linkCartToCustomer } from '@/lib/cart/account-link';
import { resolveAccountCartRequest } from '@/lib/cart/account-request';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { GET, POST } from './route';

vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/cart/account-request', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/cart/account-request')>();
  return { ...actual, resolveAccountCartRequest: vi.fn() };
});
vi.mock('@/lib/cart/account-link', () => ({
  getCustomerCart: vi.fn(),
  linkCartToCustomer: vi.fn(),
}));
vi.mock('@/lib/cart/session-proof', () => ({
  CART_FULL_SESSION_OPERATIONS: [
    'add',
    'set_quantity',
    'remove',
    'clear',
    'replace',
    'set_assurance',
    'set_negotiated_price',
  ],
  CART_SESSION_PROOF_VERSION: 'cp1',
  cartSessionCookieMaxAge: vi.fn(() => 3600),
  issueCartSessionProof: vi.fn(),
  verifyCartSessionProof: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
const context = {
  ok: true,
  merchant: { id: 'm', slug: 'shop' },
  principal: {
    merchantId: 'm',
    principalId: 'old',
    scope: 'session',
    cartId: 'c',
    grantId: 'g',
  },
  customer: { userId: 'user' },
};
const request = (body = '{}', headers: Record<string, string> = {}) =>
  new Request('https://shop.test/api/storefront/cart/account', {
    method: 'POST',
    body,
    headers,
  }) as NextRequest;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
  vi.mocked(resolveAccountCartRequest).mockResolvedValue(context as never);
});
it('reads the saved cart without minting or mutating authority', async () => {
  vi.mocked(getCustomerCart).mockResolvedValue({ ok: true, cart: null });
  expect((await GET(request())).status).toBe(200);
  expect(linkCartToCustomer).not.toHaveBeenCalled();
  expect(issueCartSessionProof).not.toHaveBeenCalled();
});
it('requires CSRF and rejects caller-selected customer/tenant identity', async () => {
  expect(
    (
      await POST(
        request('{"operationId":"x","choice":"use_saved","customerId":"other"}')
      )
    ).status
  ).toBe(400);
  vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: false });
  expect((await POST(request())).status).toBe(403);
  expect(linkCartToCustomer).not.toHaveBeenCalled();
});
it('issues the selected rotated principal only after an atomic account choice', async () => {
  vi.mocked(linkCartToCustomer).mockResolvedValue({
    ok: true,
    cart: { cartId: 'selected', expiresAt: '2099-01-01T00:00:00Z' },
    grantId: 'new-grant',
    principalId: 'rotated',
    operationId: 'x',
    warnings: [],
    replayed: false,
  } as never);
  vi.mocked(issueCartSessionProof).mockReturnValue('cp1.safe.signature');
  const response = await POST(
    request('{"operationId":"x","choice":"use_saved"}')
  );
  expect(response.status).toBe(200);
  // The session cookie is capped at the (mocked) cart-expiry lifetime,
  // never the full 24h proof TTL.
  expect(response.headers.get('set-cookie')).toContain('Max-Age=3600');
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(issueCartSessionProof).toHaveBeenCalledWith(
    expect.objectContaining({
      principalId: 'rotated',
      cartId: 'selected',
      grantId: 'new-grant',
    }),
    expect.anything()
  );
  expect((await response.json()).linkedUserId).toBe('user');
});
it('returns the rotated proof to native callers presenting it via the proof header', async () => {
  vi.mocked(linkCartToCustomer).mockResolvedValue({
    ok: true,
    cart: { cartId: 'selected', expiresAt: '2099-01-01T00:00:00Z' },
    grantId: 'new-grant',
    principalId: 'rotated',
    operationId: 'x',
    warnings: [],
    replayed: false,
  } as never);
  vi.mocked(issueCartSessionProof).mockReturnValue('cp1.rotated.signature');
  // Native transport: Authorization carries the shopper JWT, so the
  // cart proof travels in X-Cart-Session-Proof. Without the rotated
  // proof in the body the client cannot adopt the linked cart and
  // retries forever against the revoked grant.
  const response = await POST(
    request('{"operationId":"x","choice":"use_saved"}', {
      authorization: 'Bearer shopper-jwt',
      'x-cart-session-proof': 'cp1.old.signature',
    })
  );
  expect(response.status).toBe(200);
  expect((await response.json()).proof).toBe('cp1.rotated.signature');
});
it('keeps the rotated proof out of the body for cookie-only web callers', async () => {
  vi.mocked(linkCartToCustomer).mockResolvedValue({
    ok: true,
    cart: { cartId: 'selected', expiresAt: '2099-01-01T00:00:00Z' },
    grantId: 'new-grant',
    principalId: 'rotated',
    operationId: 'x',
    warnings: [],
    replayed: false,
  } as never);
  vi.mocked(issueCartSessionProof).mockReturnValue('cp1.rotated.signature');
  const response = await POST(
    request('{"operationId":"x","choice":"use_saved"}')
  );
  expect(response.status).toBe(200);
  expect((await response.json()).proof).toBeUndefined();
  expect(response.headers.get('set-cookie')).toContain('Max-Age=3600');
});
it('authenticates before parsing the account-link body', async () => {
  vi.mocked(resolveAccountCartRequest).mockResolvedValue({
    ok: false,
    error: 'unauthorized',
  });
  const response = await POST(request('not-json'));
  expect(response.status).toBe(401);
  expect(issueCartSessionProof).not.toHaveBeenCalled();
});
it('does not issue proof or cookie when account authority is rejected', async () => {
  vi.mocked(resolveAccountCartRequest).mockResolvedValue({
    ok: false,
    error: 'unauthorized',
  });
  const response = await POST(
    request('{"operationId":"x","choice":"use_saved"}')
  );
  expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(issueCartSessionProof).not.toHaveBeenCalled();
});
