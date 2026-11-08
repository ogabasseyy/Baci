import { render, screen } from '@testing-library/react';
import type React from 'react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProductDetails } from './product-details-helpers';

vi.mock('next/link', () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/routes', () => ({
  asRoute: (path: string) => path,
}));

import { ProductBreadcrumbs } from './product-breadcrumbs';

const productData = {
  id: 'product-1',
  name: 'iPhone 17 Pro Max',
  slug: 'iphone-17-pro-max',
  category: 'Smartphones',
  categorySlug: 'smartphones',
  categories: { id: 'cat-1', name: 'Smartphones', slug: 'smartphones' },
  colorImages: {},
  colors: [],
  condition: 'new',
  description: 'Flagship phone',
  detailedSpecs: [],
  image: '/product.png',
  images: ['/product.png'],
  platforms: [],
  price: '₦2,000,000',
  rawPrice: 2000000,
  rating: 5,
  reviewCount: 12,
  specs: [],
  storage: [],
} as unknown as NormalizedProductDetails;

describe('ProductBreadcrumbs', () => {
  it('disables prefetch for breadcrumb navigation links', () => {
    const homeHref = '/ogabassey' as Route;

    render(
      <ProductBreadcrumbs
        basePath="/ogabassey"
        homeHref={homeHref}
        productData={productData}
      />
    );

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'data-prefetch',
      'false'
    );
    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
    expect(
      screen.getByRole('link', { name: 'Smartphones' })
    ).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByText('iPhone 17 Pro Max')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      document.querySelectorAll('svg[aria-hidden="true"][role="presentation"]')
    ).toHaveLength(2);
  });

  it('does not emit a duplicate breadcrumb JSON-LD script', () => {
    render(
      <ProductBreadcrumbs
        basePath="/ogabassey"
        homeHref={'/ogabassey' as Route}
        productData={productData}
      />
    );

    expect(
      document.querySelector('script[type="application/ld+json"]')
    ).toBeNull();
  });
});
