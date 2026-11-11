import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  merchant: vi.fn(),
  head: vi.fn(),
  boundary: vi.fn(),
}));
vi.mock('@/lib/cached-data', () => ({ getRequestScopedMerchant: f.merchant }));
vi.mock('@/lib/experience/published-manifest', () => ({
  loadPublishedExperience: f.head,
}));
vi.mock('@/lib/experience/route-data-revision', () => ({
  resolveExperienceBoundary: f.boundary,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('NOT_FOUND');
  },
}));

import { generateMetadata } from './page';

it('keeps canonical collection metadata bound to an existing published route and rejects missing handles', async () => {
  f.merchant.mockResolvedValue({ id: 'm', slug: 'qa1' });
  f.head.mockResolvedValue({
    routes: [{ path: '/collections/[handle]', view: 'collection' }],
  });
  f.boundary.mockResolvedValue({
    title: 'Synthetic collection',
    canonicalUrl: 'http://localhost/qa1/collections/all',
  });
  expect(
    await generateMetadata({
      params: Promise.resolve({ slug: 'qa1', handle: 'all' }),
    })
  ).toMatchObject({
    alternates: { canonical: 'http://localhost/qa1/collections/all' },
  });
  f.boundary.mockResolvedValue(null);
  await expect(
    generateMetadata({
      params: Promise.resolve({ slug: 'qa1', handle: 'missing' }),
    })
  ).rejects.toThrow('NOT_FOUND');
});
