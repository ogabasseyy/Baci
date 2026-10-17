import type { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { revokeCartDeviceGrants } from '@/lib/cart/device-session';
import { resolveCartRequestContext } from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { checkCsrfProtection } from '@/lib/csrf';
import { POST } from './route';

vi.mock('@/lib/cart/device-session', () => ({
  revokeCartDeviceGrants: vi.fn(),
}));
vi.mock('@/lib/cart/request-context', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('@/lib/cart/request-context')),
  resolveCartRequestContext: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));
vi.mock('@/lib/cart/request-quota', () => ({ checkCartQuota: vi.fn() }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
const request = (body = '{}') =>
  new Request('https://shop.example/api/storefront/cart/session/revoke', {
    method: 'POST',
    body,
  }) as NextRequest;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: false,
    error: 'missing_proof',
  });
  vi.mocked(checkCartQuota).mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetTime: 0,
  });
});
it('resolves revocation context without an enrollment feature lookup', async () => {
  await POST(request());
  const deps = vi.mocked(resolveCartRequestContext).mock.calls[0]?.[1];
  expect(deps?.merchant).not.toHaveProperty('loadMerchantFeatures');
});
it('requires CSRF and verified cart authority before revocation', async () => {
  expect((await POST(request())).status).toBe(401);
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
  vi.mocked(checkCsrfProtection).mockResolvedValue({
    valid: false,
  });
  expect((await POST(request())).status).toBe(403);
});
it('rejects malformed or caller-selected tenant/grant fields', async () => {
  // Unauthenticated callers get the auth error before any body handling.
  expect((await POST(request('{bad'))).status).toBe(401);
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: true,
    merchant: { id: 'm', slug: 'shop', customDomain: null },
    principal: {
      merchantId: 'm',
      cartId: 'c',
      grantId: 'g',
      principalId: 'p',
      scope: 'session' as const,
      allowedOperations: [],
      expiresAt: '2099-01-01T00:00:00Z',
    },
  });
  expect((await POST(request('{bad'))).status).toBe(400);
  expect((await POST(request('{"merchantId":"other"}'))).status).toBe(400);
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
});
it('blocks revocation when the per-principal quota is exceeded', async () => {
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: true,
    merchant: { id: 'm', slug: 'shop', customDomain: null },
    principal: {
      merchantId: 'm',
      cartId: 'c',
      grantId: 'g',
      principalId: 'p',
      scope: 'session' as const,
      allowedOperations: [],
      expiresAt: '2099-01-01T00:00:00Z',
    },
  });
  vi.mocked(checkCartQuota).mockResolvedValue({
    allowed: false,
    limit: 60,
    remaining: 0,
    resetTime: 0,
  });
  expect((await POST(request())).status).toBe(429);
  expect(checkCartQuota).toHaveBeenCalledWith({
    merchantId: 'm',
    operation: 'session_revoke',
    subject: 'p',
  });
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
});
it('expires presented cart cookies when the proof is definitively invalid', async () => {
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: false,
    error: 'invalid_proof',
    merchant: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'shop',
      customDomain: null,
    },
  });
  const response = await POST(
    new Request('http://localhost/api/storefront/cart/session/revoke', {
      method: 'POST',
      headers: {
        cookie:
          'baci-cart-11111111-1111-4111-8111-111111111111=cp1.dead.dead; other=1',
      },
      body: '{}',
    }) as never
  );
  expect(response.status).toBe(401);
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain(
    'baci-cart-11111111-1111-4111-8111-111111111111=;'
  );
  expect(setCookie).toContain('Max-Age=0');
  expect(setCookie).not.toContain('other=');
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
});
it('expires presented cart cookies when the proof expired beyond grace', async () => {
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: false,
    error: 'expired_proof',
    merchant: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'shop',
      customDomain: null,
    },
  });
  const response = await POST(
    new Request('http://localhost/api/storefront/cart/session/revoke', {
      method: 'POST',
      headers: {
        cookie:
          'baci-cart-11111111-1111-4111-8111-111111111111=cp1.dead.dead; other=1',
      },
      body: '{}',
    }) as never
  );
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain(
    'baci-cart-11111111-1111-4111-8111-111111111111=;'
  );
  expect(setCookie).toContain('Max-Age=0');
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
});
it('preserves another merchant cookie on a shared host during invalid-proof expiry', async () => {
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: false,
    error: 'invalid_proof',
    merchant: {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'shop',
      customDomain: null,
    },
  });
  const payloadFor = (merchantId: string) =>
    `cp1.${Buffer.from(
      JSON.stringify({
        aud: 'cart',
        cartId: null,
        env: 'test',
        exp: 1999999999,
        grantId: null,
        iat: 1700000000,
        merchantId,
        principalId: 'guest',
        scope: 'session',
        v: 'cp1',
      })
    ).toString('base64url')}.dead`;
  const merchantA = '11111111-1111-4111-8111-111111111111';
  const merchantB = '22222222-2222-4222-8222-222222222222';
  const response = await POST(
    new Request('http://localhost/api/storefront/cart/session/revoke', {
      method: 'POST',
      headers: {
        cookie: `baci-cart-${merchantA}=${payloadFor(merchantA)}; baci-cart-${merchantB}=${payloadFor(merchantB)}`,
      },
      body: '{}',
    }) as never
  );
  expect(response.status).toBe(401);
  const setCookie = response.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain(`baci-cart-${merchantA}=;`);
  expect(setCookie).not.toContain(`baci-cart-${merchantB}=;`);
});
it('clears only the resolved merchant cookie after idempotent scoped revocation', async () => {
  const principal = {
    merchantId: 'm',
    cartId: 'c',
    grantId: 'g',
    principalId: 'p',
    scope: 'session' as const,
    allowedOperations: [],
    expiresAt: '2099-01-01T00:00:00Z',
  };
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: true,
    merchant: { id: 'm', slug: 'shop', customDomain: null },
    principal,
  });
  vi.mocked(revokeCartDeviceGrants).mockResolvedValue({ ok: true });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(revokeCartDeviceGrants).toHaveBeenCalledWith(principal);
});
