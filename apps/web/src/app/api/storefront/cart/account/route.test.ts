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
vi.mock('@/lib/cart/account-request', () => ({
  resolveAccountCartRequest: vi.fn(),
}));
vi.mock('@/lib/cart/account-link', () => ({
  getCustomerCart: vi.fn(),
  linkCartToCustomer: vi.fn(),
}));
vi.mock('@/lib/cart/session-proof', () => ({
  issueCartSessionProof: vi.fn(),
  verifyCartSessionProof: vi.fn(),
  CART_SESSION_PROOF_TTL_SECONDS: 86400,
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
const request = (body = '{}') =>
  new Request('https://shop.test/api/storefront/cart/account', {
    method: 'POST',
    body,
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
