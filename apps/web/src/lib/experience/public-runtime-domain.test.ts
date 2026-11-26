// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('./published-manifest', () => ({
  parsePublishedExperience: (value: unknown) => value,
}));
vi.mock('./catalog-adapter', () => ({
  loadExperienceCatalog: vi.fn(async () => ({ products: [], revision: 'r' })),
}));
vi.mock('./route-resolver', () => ({
  resolveExperienceRoute: vi.fn(async () => ({
    kind: 'route',
    route: { view: 'home', params: {}, canonicalPath: '/' },
  })),
}));
vi.mock('./public-bootstrap', () => ({
  buildPublicBootstrap: vi.fn(() => ({
    catalog: { products: [], revision: 'r' },
    route: { canonicalPath: '/' },
    capabilities: [],
  })),
}));

import { createPublicExperienceRuntime } from './public-runtime';

it('uses one current asynchronous canonical-domain result and rejects a changed domain', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const head = {
    merchantId: id,
    buildDigest: 'a'.repeat(64),
    hostOrigin: 'https://shop.example.com',
    capabilities: [],
    routes: [],
    assets: [],
    policyRevision: 'p',
    assetsDigest: 'b'.repeat(64),
  };
  const client = {
    rpc: vi.fn(async () => ({ data: head, error: null })),
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({
          data: {
            id,
            slug: 'synthetic',
            business_name: 'Synthetic',
            is_published: true,
          },
          error: null,
        }),
      };
      return q;
    },
  };
  const canonicalBase = vi.fn(async () => 'https://shop.example.com');
  const runtime = createPublicExperienceRuntime({
    client: client as never,
    runtimeBase: 'https://output.runtime.test',
    canonicalBase,
  });
  const result = await runtime.resolveBoundary({ id, slug: 'synthetic' }, '/');
  expect(result?.launch.canonicalBase).toBe('https://shop.example.com');
  expect(canonicalBase).toHaveBeenCalledOnce();
  canonicalBase.mockResolvedValueOnce('https://changed.example.com');
  expect(
    await runtime.resolveBoundary({ id, slug: 'synthetic' }, '/')
  ).toBeNull();
});
