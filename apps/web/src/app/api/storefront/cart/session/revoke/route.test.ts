import type { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { revokeCartDeviceGrants } from '@/lib/cart/device-session';
import { resolveCartRequestContext } from '@/lib/cart/request-context';
import { checkCsrfProtection } from '@/lib/csrf';
import { POST } from './route';

vi.mock('@/lib/cart/device-session', () => ({
  revokeCartDeviceGrants: vi.fn(),
}));
vi.mock('@/lib/cart/request-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cart/request-context')>()),
  resolveCartRequestContext: vi.fn(),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));
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
  expect((await POST(request('{bad'))).status).toBe(400);
  expect((await POST(request('{"merchantId":"other"}'))).status).toBe(400);
  expect(revokeCartDeviceGrants).not.toHaveBeenCalled();
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
