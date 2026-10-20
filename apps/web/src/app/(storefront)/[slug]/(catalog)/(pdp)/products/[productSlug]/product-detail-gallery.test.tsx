import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { ProductDetailGallery } from './product-detail-gallery';

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div data-alt={alt} data-src={src} />
  ),
}));

const product = {
  name: 'Widget',
  image: 'main.jpg',
  imageLarge: 'main-large.jpg',
  imageHint: 'widget',
  images: [
    { url: 'extra-1.jpg', alt: 'Side view' },
    { url: '', alt: 'Empty' },
  ],
} as Product;

describe('ProductDetailGallery', () => {
  it('renders the hero from the selected image', () => {
    render(
      <ProductDetailGallery
        product={product}
        selectedImage="extra-1.jpg"
        onSelectImage={vi.fn()}
      />
    );
    const hero = document.querySelector('[data-alt="Widget"]');
    expect(hero?.getAttribute('data-src')).toBe('extra-1.jpg');
  });

  it('selects a thumbnail on click and skips empty urls', () => {
    const onSelectImage = vi.fn();
    render(
      <ProductDetailGallery
        product={product}
        selectedImage="main-large.jpg"
        onSelectImage={onSelectImage}
      />
    );
    const buttons = screen.getAllByRole('button');
    // Main thumbnail plus one non-empty extra image.
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onSelectImage).toHaveBeenCalledWith('extra-1.jpg');
  });

  it('renders no thumbnails when the product has no extra images', () => {
    render(
      <ProductDetailGallery
        product={{ ...product, images: [] }}
        selectedImage="main-large.jpg"
        onSelectImage={vi.fn()}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
