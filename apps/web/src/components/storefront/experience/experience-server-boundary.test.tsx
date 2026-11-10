import { expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ runtime: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/experience/storefront-runtime', () => ({
  getExperienceStorefrontRuntime: f.runtime,
}));
vi.mock('@/lib/experience/route-data-revision', () => ({
  resolveExperienceBoundary: f.resolve,
}));

import { ExperienceServerBoundary } from './experience-server-boundary';

it('preserves exact native content when disabled or the route is not in the published map', async () => {
  const fallback = <p>Existing native store</p>;
  f.runtime.mockReturnValue(null);
  expect(
    await ExperienceServerBoundary({
      merchant: { id: 'm' },
      path: '/',
      fallback,
    })
  ).toBe(fallback);
  expect(f.resolve).not.toHaveBeenCalled();
  f.runtime.mockReturnValue({});
  f.resolve.mockResolvedValue(null);
  expect(
    await ExperienceServerBoundary({
      merchant: { id: 'm' },
      path: '/reserved',
      fallback,
    })
  ).toBe(fallback);
});
