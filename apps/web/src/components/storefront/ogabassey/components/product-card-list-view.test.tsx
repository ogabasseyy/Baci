import { fireEvent, render, screen } from '@testing-library/react';
import type { Route } from 'next';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';
import { ProductCardListView } from './product-card-list-view';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { alt, fill: _fill, preload: _preload, ...imageProps } = props;
    // biome-ignore lint/performance/noImgElement: test mock
    return <img {...imageProps} alt={String(alt ?? '')} />;
  },
}));

vi.mock('next/link', () => ({
  default: (
    props: { children: React.ReactNode; href: string } & Record<string, unknown>
  ) => {
    const { children, prefetch: _prefetch, ...anchorProps } = props;
    return <a {...anchorProps}>{children}</a>;
  },
}));

const baseProduct: Product = {
  category: 'smartphones',
  condition: 'New',
  description: 'A flagship smartphone',
  id: 'p-1',
  image: 'https://cdn.ogabassey.com/products/iphone-18-pro.avif',
  name: 'iPhone 18 Pro',
  price: '₦2,078,000',
  rating: 4.5,
  slug: 'iphone-18-pro',
};

describe('ProductCardListView', () => {
  it('propagates imagePriority to the list-view image and renders badge, rating, and description', () => {
    render(
      <ProductCardListView
        badge={{ colorClass: 'bg-emerald-500', label: 'New' }}
        contentVisibilityClasses=""
        descriptionPreview="A flagship smartphone"
        handleCartClick={vi.fn()}
        imagePriority={true}
        isComparing={false}
        isLiked={false}
        linkAriaLabel="Buy iPhone 18 Pro for ₦2,078,000"
        linkTitle="iPhone 18 Pro - New"
        product={baseProduct}
        productHref={'/smartphones/iphone-18-pro' as Route}
        requiresSelection={false}
        showPlusOne={false}
        showRating={true}
        toggleCompare={vi.fn()}
        toggleLike={vi.fn()}
      />
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('(4.5)')).toBeInTheDocument();
    expect(screen.getByText('A flagship smartphone')).toBeInTheDocument();
  });

  it('keeps list-view images lazy by default and invokes cart, compare, and wishlist callbacks', () => {
    const handleCartClick = vi.fn();
    const toggleCompare = vi.fn();
    const toggleLike = vi.fn();

    render(
      <ProductCardListView
        badge={null}
        contentVisibilityClasses=""
        descriptionPreview="A flagship smartphone"
        handleCartClick={handleCartClick}
        isComparing={true}
        isLiked={true}
        linkAriaLabel="Buy iPhone 18 Pro for ₦2,078,000"
        linkTitle="iPhone 18 Pro"
        product={baseProduct}
        productHref={'/smartphones/iphone-18-pro' as Route}
        requiresSelection={false}
        showPlusOne={true}
        showRating={false}
        toggleCompare={toggleCompare}
        toggleLike={toggleLike}
      />
    );

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('fetchpriority', 'auto');
    expect(screen.getByText('+1')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Add iPhone 18 Pro to cart' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from comparison' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove from wishlist' })
    );

    expect(handleCartClick).toHaveBeenCalledTimes(1);
    expect(toggleCompare).toHaveBeenCalledTimes(1);
    expect(toggleLike).toHaveBeenCalledTimes(1);
  });

  it('renders View Options link instead of Add to Cart button when requiresSelection is true', () => {
    render(
      <ProductCardListView
        badge={null}
        contentVisibilityClasses=""
        descriptionPreview="Choose options"
        handleCartClick={vi.fn()}
        isComparing={false}
        isLiked={false}
        linkAriaLabel="Buy iPhone 18 Pro for ₦2,078,000"
        linkTitle="iPhone 18 Pro"
        product={baseProduct}
        productHref={'/smartphones/iphone-18-pro' as Route}
        requiresSelection={true}
        showPlusOne={false}
        showRating={false}
        toggleCompare={vi.fn()}
        toggleLike={vi.fn()}
      />
    );

    expect(
      screen.getByRole('link', { name: 'Choose options for iPhone 18 Pro' })
    ).toHaveAttribute('href', '/smartphones/iphone-18-pro');
  });
});
