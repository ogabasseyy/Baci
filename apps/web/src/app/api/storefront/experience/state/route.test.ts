import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  runtime: vi.fn(),
  resolve: vi.fn(),
  quota: vi.fn(),
  state: vi.fn(),
}));
vi.mock('@/lib/experience/storefront-runtime', () => ({
  getExperienceStorefrontRuntime: f.runtime,
}));
vi.mock('@/lib/experience/published-request-context', () => ({
  resolvePublishedExperienceRequest: f.resolve,
}));
vi.mock('@/lib/experience/public-request', async (original) => ({
  ...(await original<object>()),
  admitPublicExperienceRead: f.quota,
}));

import { GET } from './route';

const request = () =>
  new NextRequest(
    `http://localhost/api/storefront/experience/state?buildDigest=${'a'.repeat(64)}&path=%2F`
  );
beforeEach(() => {
  vi.clearAllMocks();
  f.runtime.mockReturnValue({ state: f.state });
  f.resolve.mockResolvedValue({ ok: true, merchant: { id: 'm', slug: 'qa1' } });
  f.quota.mockResolvedValue(true);
});
it('is unavailable by default and never creates a cart or launch', async () => {
  f.runtime.mockReturnValue(null);
  expect((await GET(request())).status).toBe(503);
  expect(f.resolve).not.toHaveBeenCalled();
});
it('validates path before tenant access and honors normal host/quota boundaries', async () => {
  expect(
    (
      await GET(
        new NextRequest(
          'http://localhost/api/storefront/experience/state?buildDigest=bad&path=/api'
        )
      )
    ).status
  ).toBe(400);
  expect(f.resolve).not.toHaveBeenCalled();
  f.resolve.mockResolvedValueOnce({ ok: false });
  expect((await GET(request())).status).toBe(403);
  f.quota.mockResolvedValue(false);
  expect((await GET(request())).status).toBe(429);
  expect(f.state).not.toHaveBeenCalled();
});
it('returns current safe state without caching and sanitizes backend errors', async () => {
  f.state.mockResolvedValueOnce({
    active: true,
    status: 'active',
    buildDigest: 'a'.repeat(64),
    policyRevision: 'p',
    catalogRevision: 'c',
  });
  const r = await GET(request());
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.json()).toMatchObject({ active: true });
  f.state.mockRejectedValueOnce(Error('private connection secret'));
  expect(await (await GET(request())).text()).not.toContain('secret');
});
