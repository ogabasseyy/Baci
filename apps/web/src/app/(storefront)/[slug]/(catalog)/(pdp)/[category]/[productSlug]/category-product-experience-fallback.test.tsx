import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ control: vi.fn(), load: vi.fn() }));
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
  loadPublishedExperience: async () => ({}),
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
