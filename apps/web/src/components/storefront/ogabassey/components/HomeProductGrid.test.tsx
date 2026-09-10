import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestProduct } from './HomeProductGrid.test-utils';

vi.mock('@baci/shared/storefront', () => ({
  prioritizeSmartphoneProducts: vi.fn((products: unknown[]) => products),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

const mockDeferredAdUnit = vi.hoisted(() =>
  vi.fn(
    ({
      fallback,
      placementKey,
    }: {
      fallback?: ReactNode;
      placementKey: string;
      timeoutMs?: number;
    }) => (
      <div data-testid={`deferred-ad-${placementKey}`}>
        {fallback}
      </div>
    )
  )
);

vi.mock('./deferred-ad-unit', () => ({
  DeferredAdUnit: (props: { fallback?: ReactNode; placementKey: string }) =>
    mockDeferredAdUnit(props),
}));

vi.mock('./HomeProductGridCard', () => ({
  HomeProductGridCard: ({
    product,
    deferImageLoading,
  }: {
    product: { name: string };
    deferImageLoading?: boolean;
  }) => (
    <article
      data-card-variant="static"
      data-defer-image-loading={String(Boolean(deferImageLoading))}
    >
      {product.name}
    </article>
  ),
}));

vi.mock('./ProductGridItem', () => ({
  ProductGridItem: ({
    product,
    deferImageLoading,
    interactiveChromeTimeoutMs,
    interactiveChromeActivateOnIdle,
  }: {
    product: { name: string };
    deferImageLoading?: boolean;
    interactiveChromeTimeoutMs?: number;
    interactiveChromeActivateOnIdle?: boolean;
  }) => (
    <article
      data-card-variant="interactive"
      data-defer-image-loading={String(Boolean(deferImageLoading))}
      data-interactive-timeout={
        interactiveChromeTimeoutMs === undefined
          ? 'default'
          : String(interactiveChromeTimeoutMs)
      }
      data-interactive-idle={String(
        interactiveChromeActivateOnIdle !== false
      )}
    >
      {product.name}
    </article>
  ),
}));

import { HomeProductGrid } from './HomeProductGrid';

describe('HomeProductGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockDeferredAdUnit.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
    });
    vi.useRealTimers();
  });

  it('limits the initial home feed to the configured display count', () => {
    render(
      <HomeProductGrid
        storeSlug="test-store"
        products={Array.from({ length: 13 }, (_, index) =>
          createTestProduct(index + 1)
        )}
      />
    );

    expect(screen.getAllByRole('article')).toHaveLength(8);
    expect(screen.queryByText('Product 13')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 8 of 13 products')).toHaveClass(
      'ogabassey-home-products__count'
    );
  });

  it('renders the critical product-grid shell classes used by the homepage CSS partition', () => {
    render(<HomeProductGrid storeSlug="test-store" products={[createTestProduct(1)]} />);

    const heading = screen.getByRole('heading', { name: 'Featured Products' });
    const section = heading.closest('section');
    const grid = screen.getByRole('article').parentElement;

    expect(section).toHaveClass('ogabassey-home-products');
    expect(section).not.toHaveClass('max-w-[1400px]');
    expect(heading).toHaveClass('ogabassey-home-products__title');
    expect(screen.getByText('Best Sellers')).toHaveClass(
      'ogabassey-home-products__eyebrow'
    );
    expect(grid).toHaveClass('ogabassey-home-products__grid');
    expect(grid).not.toHaveClass('grid-cols-2');
  });

  it('links the view-all CTA to the storefront products route', () => {
    render(
      <HomeProductGrid
        storeSlug="test-store"
        products={[createTestProduct(1)]}
      />
    );

    expect(
      screen.getByRole('link', { name: 'View all products' })
    ).toHaveAttribute('href', '/test-store/products');
    expect(
      screen.getByRole('link', { name: 'View all products' })
    ).toHaveAttribute('data-prefetch', 'false');
  });

  it('uses an explicit server-resolved basePath so custom domains avoid slug-prefixed links', () => {
    render(
      <HomeProductGrid
        basePath=""
        storeSlug="ogabassey"
        products={[createTestProduct(1)]}
      />
    );

    expect(
      screen.getByRole('link', { name: 'View all products' })
    ).toHaveAttribute('href', '/products');
  });

  it('normalizes a trailing slash on basePath to avoid double slashes in links', () => {
    // Regression: a basePath of `/ogabassey/` (trailing slash) previously
    // produced `/ogabassey//products` because the string was concatenated
    // directly. The component trims trailing slashes before building the
    // href.
    render(
      <HomeProductGrid
        basePath="/ogabassey/"
        storeSlug="ogabassey"
        products={[createTestProduct(1)]}
      />
    );

    expect(
      screen.getByRole('link', { name: 'View all products' })
    ).toHaveAttribute('href', '/ogabassey/products');
  });

  it('defers every home feed image so High product photos cannot steal mobile LCP', () => {
    render(
      <HomeProductGrid
        storeSlug="test-store"
        products={Array.from({ length: 6 }, (_, index) =>
          createTestProduct(index + 1)
        )}
      />
    );

    for (const card of screen.getAllByRole('article')) {
      expect(card).toHaveAttribute('data-defer-image-loading', 'true');
    }
  });

  it('mounts the inline grid ad slot and delegates space reservation to it', () => {
    render(
      <HomeProductGrid
        storeSlug="test-store"
        products={Array.from({ length: 8 }, (_, index) =>
          createTestProduct(index + 1)
        )}
      />
    );

    // The grid mounts a deferred MPU slot at the breakpoint. The height-locked
    // reservation is now owned by DeferredAdUnit's default AdSlotShell (see
    // deferred-ad-unit + ad-slot-shell tests), so the grid no longer hand-rolls
    // a mismatched `min-height` fallback.
    expect(mockDeferredAdUnit).toHaveBeenCalledWith(
      expect.objectContaining({
        placementKey: 'PRODUCT_GRID_MPU',
        timeoutMs: 1,
      })
    );
    expect(mockDeferredAdUnit.mock.calls[0]?.[0]?.fallback).toBeUndefined();
    expect(
      screen.getByTestId('deferred-ad-PRODUCT_GRID_MPU')
    ).toBeInTheDocument();
  });
});
