import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';
import { ProductIndexCard } from './product-index-card';

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    loading,
    fetchPriority,
  }: {
    alt: string;
    src: string;
    loading?: 'eager' | 'lazy';
    fetchPriority?: 'high' | 'auto';
  }) => (
    // biome-ignore lint/performance/noImgElement: test stub for next/image
    <img alt={alt} src={src} loading={loading} fetchPriority={fetchPriority} />
  ),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    'aria-label': label,
  }: {
    children: ReactNode;
    href: string;
    'aria-label'?: string;
  }) => (
    <a href={href} aria-label={label}>
      {children}
    </a>
  ),
}));

function makeProduct(
  overrides: Partial<NormalizedProduct> = {}
): NormalizedProduct {
  return {
    id: 'product-1',
    name: 'iPhone 13 Pro',
    slug: 'iphone-13-pro',
    description: 'Phone',
    image: 'https://example.com/iphone.jpg',
    imageLarge: 'https://example.com/iphone.jpg',
    images: ['https://example.com/iphone.jpg'],
    category: 'Phones',
    category_slug: 'phones',
    brand: 'Apple',
    price: 550000,
    compare_at_price: null,
    condition: 'new',
    stock: 10,
    rating: 4.5,
    availability: 'InStock',
    available_conditions: [],
    variant_model: 'legacy',
    ...overrides,
  };
}

describe('ProductIndexCard imagePriority', () => {
  it('does not defer the explicitly selected first-screen image', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct()}
        imagePriority={true}
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'eager');
    expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'high');
  });

  it('keeps ordinary cards lazy rather than competing with first-screen images', () => {
    render(
      <ProductIndexCard
        formattedPrice="₦550,000"
        pathPrefix=""
        product={makeProduct()}
      />
    );
    expect(screen.getByRole('img')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('img')).toHaveAttribute('fetchpriority', 'auto');
  });
});
