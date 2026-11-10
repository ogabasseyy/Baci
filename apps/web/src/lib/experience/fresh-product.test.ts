// @vitest-environment node
import { expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ runtime: vi.fn(), head: vi.fn() }));
vi.mock('./storefront-runtime', () => ({
  getExperienceStorefrontRuntime: mocked.runtime,
}));
vi.mock('./published-manifest', () => ({
  loadPublishedExperience: mocked.head,
}));

import { loadFreshExperienceProduct } from './fresh-product';

it('uses the current safe price/currency and current missing-product result for opted-in metadata/body reads', async () => {
  const merchant = { id: 'm', slug: 'qa1', payout_currency: 'USD' };
  const catalog = vi.fn().mockResolvedValue({
    products: [
      {
        id: 'p',
        slug: 'device',
        name: 'Synthetic',
        price: 275,
        currency: 'NGN',
        canonicalPath: '/phones/device',
        available: true,
        variants: [],
      },
    ],
    revision: 'current',
  });
  mocked.runtime.mockReturnValue({ catalog });
  mocked.head.mockResolvedValue({
    routes: [{ path: '/products/[handle]', view: 'product' }],
  });
  expect(
    await loadFreshExperienceProduct(merchant as never, 'device')
  ).toMatchObject({
    active: true,
    merchant: { payout_currency: 'NGN' },
    product: { price: 275, canonical_url: '/phones/device' },
  });
  catalog.mockResolvedValue({ products: [], revision: 'current' });
  expect(
    await loadFreshExperienceProduct(merchant as never, 'missing')
  ).toMatchObject({ active: true, product: null });
  mocked.runtime.mockReturnValue(null);
  expect(await loadFreshExperienceProduct(merchant as never, 'device')).toEqual(
    { active: false }
  );
});

it('leaves native PDP reads intact for a home-only published experience', async () => {
  const catalog = vi.fn();
  mocked.runtime.mockReturnValue({ catalog });
  mocked.head.mockResolvedValue({ routes: [{ path: '/', view: 'home' }] });
  expect(
    await loadFreshExperienceProduct(
      { id: 'm', slug: 'qa1' } as never,
      'device'
    )
  ).toEqual({ active: false });
  expect(catalog).not.toHaveBeenCalled();
});
