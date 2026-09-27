import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedStorefrontHomeProducts,
  getCachedStorefrontLaunchProducts,
} from '@/lib/cached-data';
import {
  createSectionProduct,
  mockSectionMerchant,
} from './ogabassey-home-section.test-fixtures';

vi.mock('@/lib/cached-data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCachedStorefrontHomeProducts: vi.fn(() => Promise.resolve([])),
    getCachedStorefrontLaunchProducts: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('@/components/storefront/ogabassey/pages/home', () => ({
  OgabasseyHomePage: ({
    basePath,
    launchProducts,
    products,
    renderHero,
    storeSlug,
  }: {
    basePath?: string;
    launchProducts?: unknown[];
    products?: unknown[];
    renderHero?: boolean;
    storeSlug?: string;
  }) => (
    <section aria-label="OgaBassey home payload">
      {storeSlug}:{basePath}:{products?.length ?? 0}:
      {launchProducts?.length ?? 0}:{String(renderHero)}
    </section>
  ),
}));

vi.mock('@/components/storefront/ogabassey/home-product-feed', () => ({
  createOgabasseyHomeProductFeed: vi.fn((products: unknown[]) =>
    products.slice(0, 1)
  ),
  mapStorefrontProductsToOgabasseyProducts: vi.fn(
    (products: unknown[]) => products
  ),
}));

import { createOgabasseyHomeProductFeed } from '@/components/storefront/ogabassey/home-product-feed';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';
import { OgabasseyHomeProductSection } from './ogabassey-home-product-section';

describe('OgabasseyHomeProductSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedStorefrontHomeProducts).mockResolvedValue([]);
    vi.mocked(getCachedStorefrontLaunchProducts).mockResolvedValue([]);
  });

  it('renders the product grid from the home-product feed without the hero', async () => {
    const result = await OgabasseyHomeProductSection({
      merchant: mockSectionMerchant,
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createSectionProduct()]),
    });

    render(result as ReactElement);

    // The launch leg is intentionally absent here: with renderHero={false}
    // the grid ignores launch slides (the Hero owns them in its own
    // streamed boundary), so the grid streams on the product feed alone.
    expect(
      screen.getByRole('region', { name: 'OgaBassey home payload' })
    ).toHaveTextContent('ogabassey:/ogabassey:1:0:false');
    expect(createOgabasseyHomeProductFeed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'product-1' })]),
      expect.objectContaining({ code: 'NGN' })
    );
  });

  it('passes the resolved merchant currency to the OgaBassey home product feed', async () => {
    const result = await OgabasseyHomeProductSection({
      merchant: {
        ...mockSectionMerchant,
        payout_currency: 'INR',
        country: 'IN',
      },
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createSectionProduct()]),
    });

    render(result as ReactElement);

    expect(createOgabasseyHomeProductFeed).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ code: 'INR', symbol: '₹' })
    );
  });

  it('still renders the grid when the launch feed fails', async () => {
    // The launch leg rejects in the background while the grid awaits only
    // the product feed: a launch outage must not take down visible products.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getCachedStorefrontLaunchProducts).mockRejectedValue(
      new Error('launch feed down')
    );
    const launchPromise = loadOgabasseyLaunchProducts('merchant-1');

    const result = await OgabasseyHomeProductSection({
      merchant: mockSectionMerchant,
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createSectionProduct()]),
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: 'OgaBassey home payload' })
    ).toBeInTheDocument();
    // Best-effort loader degrades to empty launch coverage on its own.
    await expect(launchPromise).resolves.toEqual([]);
  });
});
