import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  runtime: vi.fn(),
  resolve: vi.fn(),
  quota: vi.fn(),
  catalog: vi.fn(),
  head: vi.fn(),
}));
vi.mock('@/lib/experience/storefront-runtime', () => ({
  getExperienceStorefrontRuntime: f.runtime,
}));
vi.mock('@/lib/experience/published-request-context', () => ({
  resolvePublishedExperienceRequest: f.resolve,
}));
vi.mock('@/lib/experience/public-request', () => ({
  admitPublicExperienceRead: f.quota,
}));

import { GET } from './route';

const head = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  buildDigest: 'a'.repeat(64),
  version: 1,
  policyRevision: 'p',
  assetsDigest: 'b'.repeat(64),
  routes: [{ path: '/', view: 'home' }],
  capabilities: ['catalog.read'],
};
beforeEach(() => {
  vi.clearAllMocks();
  f.runtime.mockReturnValue({
    loadPublishedManifest: f.head,
    catalog: f.catalog,
  });
  f.resolve.mockResolvedValue({
    ok: true,
    merchant: { id: head.merchantId, slug: 'qa1' },
  });
  f.quota.mockResolvedValue(true);
  f.head.mockResolvedValue(head);
  f.catalog.mockResolvedValue({ products: [], revision: 'r' });
});
it('returns a current no-store safe projection and rejects caller tenant/price selections before access', async () => {
  const r = await GET(
    new NextRequest(
      'http://localhost/api/storefront/experience/catalog?handle=all'
    )
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('no-store');
  expect(await r.json()).toEqual({ products: [], revision: 'r' });
  f.resolve.mockClear();
  expect(
    (
      await GET(
        new NextRequest(
          'http://localhost/api/storefront/experience/catalog?merchantId=other'
        )
      )
    ).status
  ).toBe(400);
  expect(f.resolve).not.toHaveBeenCalled();
});
it('fails closed when publication changes during projection', async () => {
  f.head
    .mockResolvedValueOnce(head)
    .mockResolvedValueOnce({ ...head, policyRevision: 'new' });
  expect(
    (
      await GET(
        new NextRequest('http://localhost/api/storefront/experience/catalog')
      )
    ).status
  ).toBe(409);
});
