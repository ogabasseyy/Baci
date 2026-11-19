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

it('supports custom editorial paths while reserved native pages cannot be claimed', async () => {
  f.merchant.mockResolvedValue({ id: 'm', slug: 'qa1' });
  f.head.mockResolvedValue({
    routes: [{ path: '/pages/story', view: 'editorial' }],
  });
  f.boundary.mockResolvedValue({
    title: 'Synthetic story',
    canonicalUrl: 'http://localhost/qa1/pages/story',
  });
  expect(
    await generateMetadata({
      params: Promise.resolve({ slug: 'qa1', experiencePath: ['story'] }),
    })
  ).toMatchObject({ title: 'Synthetic story' });
  await expect(
    generateMetadata({
      params: Promise.resolve({ slug: 'qa1', experiencePath: ['privacy'] }),
    })
  ).rejects.toThrow('NOT_FOUND');
});
