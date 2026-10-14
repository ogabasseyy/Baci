import type { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { getCartRealtimeAccess } from '@/lib/cart/realtime-access';
import {
  checkCartQuota,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { GET } from './route';

vi.mock('@/lib/cart/request-context', () => ({
  resolveCartRequestContext: vi.fn(),
  checkCartQuota: vi.fn(),
}));
vi.mock('@/lib/cart/realtime-access', () => ({
  getCartRealtimeAccess: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn(() => ({})) }));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
const request = () =>
  new Request(
    'https://shop.example/api/storefront/cart/realtime'
  ) as NextRequest;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveCartRequestContext).mockResolvedValue({
    ok: false,
    error: 'missing_proof',
  });
});
it('never issues credentials for an unauthenticated request', async () => {
  expect((await GET(request())).status).toBe(401);
  expect(getCartRealtimeAccess).not.toHaveBeenCalled();
});
it('returns a private, noncacheable receiver credential after authorization', async () => {
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
  vi.mocked(checkCartQuota).mockResolvedValue({
    allowed: true,
    limit: 240,
    remaining: 239,
    resetTime: 0,
  });
  vi.mocked(getCartRealtimeAccess).mockResolvedValue({
    ok: true,
    topic: 'cart:m:c',
    token: 'receive-only',
    expiresAt: '2099-01-01T00:00:00Z',
  });
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({
    topic: 'cart:m:c',
    token: 'receive-only',
    expiresAt: '2099-01-01T00:00:00Z',
  });
});
