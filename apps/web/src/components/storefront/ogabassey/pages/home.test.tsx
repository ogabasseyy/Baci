import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';

const mockHomeProductGrid = vi.hoisted(() =>
  vi.fn(
    (props: {
      storeSlug?: string;
      products?: unknown[];
      initialDisplayCount?: number;
      inlineAdBreakpoints?: number[];
    }) => <div>Product grid {String(props.storeSlug)}</div>
  )
);
const mockDeferredAdUnit = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => (
    <div>
      <span>Ad unit {String(props.placementKey ?? 'Ad')}</span>
      {props.fallback as ReactNode}
    </div>
  ))
);
const mockHero = vi.hoisted(() =>
  vi.fn((props: { slides?: Array<{ href?: string; ctaLabel?: string }> }) => (
    <section aria-label="Launch hero">
      Hero
      {(props.slides ?? []).map((slide, index) => (
        <a href={slide.href} key={`${slide.href}-${index}`}>
          {slide.ctaLabel ?? 'Shop now'}
        </a>
      ))}
    </section>
  ))
);

vi.mock('@baci/shared', () => ({
  prioritizeSmartphoneProducts: vi.fn((products: unknown[]) => products),
}));
vi.mock('../components/Hero', () => ({
  Hero: (props: { slides?: Array<{ href?: string; ctaLabel?: string }> }) =>
    mockHero(props),
}));
vi.mock('../components/HomeProductGrid', () => ({
  HomeProductGrid: (props: Record<string, unknown>) =>
    mockHomeProductGrid(props as Parameters<typeof mockHomeProductGrid>[0]),
}));
vi.mock('../components/deferred-ad-unit', () => ({
  DeferredAdUnit: (props: Record<string, unknown>) => mockDeferredAdUnit(props),
}));

import { OgabasseyHomePage } from './home';

const launchProduct = (overrides: Partial<Product>): Product => ({
  id: 'a27',
  name: 'Samsung Galaxy A27 5G Preorder',
  description: '',
  price: '₦50,000',
  image: 'https://cdn.ogabassey.com/core-assets/products/a27.avif',
  slug: 'samsung-galaxy-a27-5g',
  brand: 'Samsung',
  category: 'Smartphones',
  categorySlug: 'smartphones',
  categories: { id: 'c1', name: 'Smartphones', slug: 'smartphones' },
  ...overrides,
});

describe('OgabasseyHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders core sections: hero, ad unit, and product grid', async () => {
    render(<OgabasseyHomePage products={[]} categories={[]} />);

    expect(
      screen.getByRole('region', { name: /launch hero/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/^Ad unit/)).toBeInTheDocument();
    // The grid arrives through the viewport gate (async module load once the
    // section activates), so await it; the static fallback holds its place.
    // jsdom never fires LCP/intersection, so drive the gate's designed
    // shopper-interaction trigger directly.
    fireEvent(window, new window.Event('pointerdown'));
    // Complete the press: the gate holds the fallback mounted while a press
    // is in flight so the tap lands on the pressed link — a bare
    // pointerdown with no completing click would hold the fallback forever.
    fireEvent(window, new window.Event('click'));
    expect(await screen.findByText(/^Product grid/)).toBeInTheDocument();
  });

  it('can omit the hero when the route shell renders it outside dynamic content', async () => {
    render(
      <OgabasseyHomePage products={[]} categories={[]} renderHero={false} />
    );

    expect(screen.queryByText(/^Hero/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Ad unit/)).toBeInTheDocument();
    fireEvent(window, new window.Event('pointerdown'));
    // Complete the press: the gate holds the fallback mounted while a press
    // is in flight so the tap lands on the pressed link — a bare
    // pointerdown with no completing click would hold the fallback forever.
    fireEvent(window, new window.Event('click'));
    expect(await screen.findByText(/^Product grid/)).toBeInTheDocument();
  });

  it('joins a slug route base path into the hero launch deep-links', () => {
    render(
      <OgabasseyHomePage
        storeSlug="test-store"
        products={[]}
        launchProducts={[launchProduct({})]}
        categories={[]}
      />
    );

    const heroLink = screen.getByRole('link', { name: 'Pre-order now' });
    expect(heroLink).toHaveAttribute(
      'href',
      expect.stringContaining('/test-store/')
    );
    expect(heroLink).toHaveAttribute(
      'href',
      expect.stringContaining('samsung-galaxy-a27-5g')
    );
  });

  it('preserves an explicit empty base path for custom-domain hero links', () => {
    render(
      <OgabasseyHomePage
        basePath=""
        storeSlug="test-store"
        products={[]}
        launchProducts={[launchProduct({})]}
        categories={[]}
      />
    );

    const heroLink = screen.getByRole('link', { name: 'Pre-order now' });
    expect(heroLink.getAttribute('href')?.startsWith('/test-store/')).toBe(
      false
    );
    expect(heroLink).toHaveAttribute(
      'href',
      expect.stringContaining('samsung-galaxy-a27-5g')
    );
  });

  it('passes products to the home product grid', async () => {
    const testProducts: Product[] = [
      {
        id: 'p-1',
        name: 'Phone',
        description: 'A smartphone',
        price: '₦100,000',
        rawPrice: 100000,
        condition: 'New',
        image: '/phone.jpg',
        brand: 'TestBrand',
        categories: {
          id: 'cat-1',
          name: 'Electronics',
          slug: 'electronics',
        },
      },
    ];
    const testCategories = [{ name: 'Electronics', slug: 'electronics' }];

    render(
      <OgabasseyHomePage
        storeSlug="test-store"
        products={testProducts}
        categories={testCategories}
      />
    );

    // The gate loads the grid module asynchronously after activation.
    // jsdom never fires LCP/intersection, so drive the gate's designed
    // shopper-interaction trigger directly.
    fireEvent(window, new window.Event('pointerdown'));
    // Complete the press: the gate holds the fallback mounted while a press
    // is in flight so the tap lands on the pressed link — a bare
    // pointerdown with no completing click would hold the fallback forever.
    fireEvent(window, new window.Event('click'));
    await waitFor(() => {
      expect(mockHomeProductGrid).toHaveBeenCalledWith(
        expect.objectContaining({
          storeSlug: 'test-store',
          products: testProducts,
          initialDisplayCount: 8,
          inlineAdBreakpoints: [12, 24],
        })
      );
    });
  });

  it('falls back to the product feed for the hero when launchProducts is omitted', () => {
    // The generic storefront renderer calls OgabasseyHomePage without
    // launchProducts; the hero must still surface products from the feed.
    render(
      <OgabasseyHomePage
        storeSlug="test-store"
        products={[launchProduct({})]}
        categories={[]}
      />
    );

    expect(screen.getByRole('link', { name: 'Pre-order now' })).toHaveAttribute(
      'href',
      expect.stringContaining('samsung-galaxy-a27-5g')
    );
  });

  it('passes empty hero slides when there are no products at all', () => {
    render(<OgabasseyHomePage products={[]} categories={[]} />);

    const hero = screen.getByRole('region', { name: /launch hero/i });
    expect(within(hero).queryByRole('link')).toBeNull();
  });

  it('keeps the homepage strip ad out of the no-interaction main-thread window', () => {
    render(<OgabasseyHomePage products={[]} categories={[]} />);

    expect(mockDeferredAdUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        placementKey: 'HOMEPAGE_STRIP',
        bootDelayMs: expect.any(Number),
      })
    );

    const homepageStripCall = mockDeferredAdUnit.mock.calls.find(
      ([props]) =>
        (props as { placementKey?: string }).placementKey === 'HOMEPAGE_STRIP'
    );

    expect(homepageStripCall).toBeDefined();
    expect(
      (homepageStripCall?.[0] as { bootDelayMs?: number }).bootDelayMs
    ).toBeGreaterThanOrEqual(9000);
    expect(homepageStripCall?.[0]).toEqual(
      expect.objectContaining({
        activateOnInteraction: true,
        timeoutMs: 0,
      })
    );
    expect(
      (homepageStripCall?.[0] as { fallback?: unknown }).fallback
    ).toBeUndefined();
  });
});
