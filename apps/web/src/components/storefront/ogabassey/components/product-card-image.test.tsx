import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import type { Product } from '../types';
import { ProductCardImage } from './product-card-image';

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { alt, fill: _fill, preload: _preload, ...imageProps } = props;
    // biome-ignore lint/performance/noImgElement: test mock
    return <img {...imageProps} alt={String(alt ?? '')} />;
  },
}));

const baseProduct: Product = {
  category: 'smartphones',
  condition: 'New',
  description: 'A test smartphone',
  id: 'p-1',
  image: 'https://cdn.ogabassey.com/products/iphone-18-pro.avif',
  name: 'iPhone 18 Pro',
  price: '₦2,078,000',
  rating: 4.8,
  slug: 'iphone-18-pro',
};

describe('ProductCardImage', () => {
  it('renders eager loading and high fetch priority when imagePriority is true', () => {
    render(
      <ProductCardImage
        className="object-cover"
        imagePriority={true}
        product={baseProduct}
        sizes="(max-width: 768px) 50vw, 25vw"
      />
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute(
      'src',
      'https://cdn.ogabassey.com/products/iphone-18-pro.avif'
    );
  });

  it('defaults to lazy loading and auto fetch priority when imagePriority is omitted', () => {
    render(
      <ProductCardImage
        className="object-cover"
        product={baseProduct}
        sizes="(max-width: 768px) 50vw, 25vw"
      />
    );
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('fetchpriority', 'auto');
  });

  it('falls back to PLACEHOLDER_IMAGE with empty alt when product image is blank', () => {
    const { container } = render(
      <ProductCardImage
        className="object-cover"
        product={{ ...baseProduct, image: '   ' }}
        sizes="100vw"
      />
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', PLACEHOLDER_IMAGE);
    expect(img).toHaveAttribute('alt', '');
  });
});
