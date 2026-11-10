import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  context: vi.fn(),
  quota: vi.fn(),
  subject: vi.fn(),
  load: vi.fn(),
  scoped: vi.fn(),
}));
vi.mock('@/lib/cart/request-context', () => ({
  resolveCartRequestContext: f.context,
  checkCartQuota: f.quota,
  createAnonMerchantFeatureLookup: vi.fn(),
}));
vi.mock('@/lib/cart/experience-cart-continuity', () => ({
  verifyContinuitySubject: f.subject,
  loadExperienceCartContinuity: f.load,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: f.scoped,
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: () => 'synthetic',
}));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  f.context.mockResolvedValue({
    ok: true,
    merchant: { id: 'm' },
    principal: { cartId: 'c', grantId: 'g', principalId: 'p' },
  });
  f.quota.mockResolvedValue({ allowed: true });
  f.subject.mockResolvedValue({ id: null });
  f.load.mockResolvedValue('a'.repeat(64));
});
it('requires the existing cart proof and withholds account carts without trusted sharing', async () => {
  f.subject.mockResolvedValue({ id: 'account' });
  const r = await GET(
    new NextRequest('http://localhost/api/storefront/cart/continuity')
  );
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({
    code: 'ACCOUNT_CART_REQUIRES_TRUSTED_FLOW',
  });
  expect(f.scoped).not.toHaveBeenCalled();
  expect(f.load).not.toHaveBeenCalled();
});
it('returns only the server-verified fingerprint and respects snapshot quota', async () => {
  const req = new NextRequest(
    'http://localhost/api/storefront/cart/continuity'
  );
  const r = await GET(req);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ fingerprint: 'a'.repeat(64) });
  f.quota.mockResolvedValue({ allowed: false });
  f.load.mockClear();
  expect((await GET(req)).status).toBe(429);
  expect(f.load).not.toHaveBeenCalled();
});
