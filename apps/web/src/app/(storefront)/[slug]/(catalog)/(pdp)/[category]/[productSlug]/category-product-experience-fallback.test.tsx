import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  control: vi.fn(),
  load: vi.fn(),
  manifest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock(
  '@/components/storefront/experience/experience-server-boundary',
  () => ({
    ExperienceServerBoundary: ({ fallback }: { fallback: ReactNode }) => (
      <>{fallback}</>
    ),
  })
);
vi.mock('@/lib/experience/published-manifest', () => ({
  loadPublishedExperience: f.manifest,
}));
vi.mock('@/lib/experience/storefront-runtime', () => ({
  getExperienceStorefrontRuntime: () => ({}),
}));
vi.mock('./category-product-route-control', () => ({
  getProductRouteControl: f.control,
}));

import Page from './page';

beforeEach(() => {
  vi.clearAllMocks();
  f.manifest.mockResolvedValue({
    routes: [{ path: '/products/[handle]', view: 'product' }],
  });
});
afterEach(cleanup);
it.each([
  ['NGN', 150000, /₦150,000/],
  ['USD', 150000, /\$150,000/],
  ['NGN', 0, /₦0/],
  ['NGN', null, /Contact for price/],
] as const)('renders the actual category fallback in %s for price %s', async (currency, price, expected) => {
  f.control.mockResolvedValue({
    result: {
      merchant: {
        id: 'synthetic-merchant',
        slug: 'qa1',
        country: 'NG',
        payout_currency: currency,
      },
      product: {
        id: 'synthetic-product',
        name: 'Synthetic Device',
        slug: 'device',
        category_slug: 'devices',
        price,
      },
      categoryMismatch: false,
      needsValuesRedirect: false,
    },
    loadProductResult: f.load,
  });
  render(
    await Page({
      params: Promise.resolve({
        slug: 'qa1',
        category: 'devices',
        productSlug: 'device',
      }),
      searchParams: Promise.resolve({}),
    })
  );
  expect(
    screen.getByRole('heading', { name: 'Synthetic Device' })
  ).toBeVisible();
  expect(screen.getByRole('main')).toHaveTextContent(expected);
  expect(f.load).not.toHaveBeenCalled();
});

it('continues the full native PDP when the experience only owns the home page', async () => {
  f.manifest.mockResolvedValue({ routes: [{ path: '/', view: 'home' }] });
  f.control.mockResolvedValue({
    result: {
      merchant: { id: 'm', slug: 'qa1', country: 'NG', payout_currency: 'NGN' },
      product: {
        id: 'p',
        name: 'Native Device',
        slug: 'device',
        category_slug: 'devices',
        price: 100,
      },
      categoryMismatch: false,
      needsValuesRedirect: false,
    },
    loadProductResult: f.load,
  });
  f.load.mockImplementation(() => {
    throw Error('NATIVE_PDP_CONTINUED');
  });
  await expect(
    Page({
      params: Promise.resolve({
        slug: 'qa1',
        category: 'devices',
        productSlug: 'device',
      }),
      searchParams: Promise.resolve({}),
    })
  ).rejects.toThrow('NATIVE_PDP_CONTINUED');
});

it('uses the validated native route slug when a product has no stored slug', async () => {
  f.control.mockResolvedValue({
    result: {
      merchant: { id: 'm', slug: 'qa1', country: 'NG', payout_currency: 'NGN' },
      product: { id: 'p', name: 'Device', category_slug: 'devices', price: 10 },
      categoryMismatch: false,
      needsValuesRedirect: false,
    },
    loadProductResult: f.load,
  });
  render(
    await Page({
      params: Promise.resolve({
        slug: 'qa1',
        category: 'devices',
        productSlug: 'device',
      }),
      searchParams: Promise.resolve({}),
    })
  );
  expect(screen.getByRole('heading', { name: 'Device' })).toBeVisible();
  expect(f.load).not.toHaveBeenCalled();
});
