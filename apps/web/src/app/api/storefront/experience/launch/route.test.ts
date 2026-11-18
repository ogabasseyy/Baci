import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  runtime: vi.fn(),
  resolve: vi.fn(),
  quota: vi.fn(),
  boundary: vi.fn(),
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

import { POST } from './route';

const request = (
  body = JSON.stringify({ buildDigest: 'a'.repeat(64), path: '/' })
) =>
  new NextRequest('http://localhost/api/storefront/experience/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
beforeEach(() => {
  vi.clearAllMocks();
  f.runtime.mockReturnValue({ resolveBoundary: f.boundary });
  f.resolve.mockResolvedValue({
    ok: true,
    merchant: { id: 'resolved', slug: 'qa1' },
  });
  f.quota.mockResolvedValue(true);
});
it('rejects malformed JSON and unavailable/mismatched heads without a launch', async () => {
  expect((await POST(request('{'))).status).toBe(400);
  expect(f.resolve).not.toHaveBeenCalled();
  f.boundary.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(409);
  f.runtime.mockReturnValue(null);
  expect((await POST(request())).status).toBe(503);
});
it('returns only the public bounded binding, without owner/source/cart authority', async () => {
  f.boundary.mockResolvedValue({
    manifest: {
      buildDigest: 'a'.repeat(64),
      policyRevision: 'p',
      ownerToken: 'PRIVATE',
    },
    bootstrap: { catalog: { revision: 'r' }, cart: { private: 'PRIVATE' } },
    launch: { expiresAt: Date.now() + 1800000, source: 'PRIVATE' },
  });
  const r = await POST(request());
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.json()).toEqual({
    buildDigest: 'a'.repeat(64),
    policyRevision: 'p',
    catalogRevision: 'r',
    expiresAt: expect.any(Number),
  });
});

it('denies unresolved hosts before boundary access', async () => {
  f.resolve.mockResolvedValueOnce({ ok: false });
  expect((await POST(request())).status).toBe(403);
  expect(f.quota).not.toHaveBeenCalled();
  expect(f.boundary).not.toHaveBeenCalled();
});
it('enforces quota before reading a public boundary', async () => {
  f.quota.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(f.boundary).not.toHaveBeenCalled();
});
it('rejects a changed build digest and returns safe unavailability for a failed boundary', async () => {
  f.boundary.mockResolvedValueOnce({
    manifest: { buildDigest: 'b'.repeat(64) },
  });
  expect((await POST(request())).status).toBe(409);
  f.boundary.mockRejectedValueOnce(Error('private synthetic details'));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'Experience unavailable.' });
});
