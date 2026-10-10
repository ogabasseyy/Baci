import { describe, expect, it } from 'vitest';
import type { Product } from '../../types';
import { toRelatedProductsProduct } from './related-product';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 42,
    merchantId: 'merchant-1',
    name: 'Pixel 9',
    price: '₦250,000',
    rawPrice: 250000,
    image: 'https://example.com/pixel9.jpg',
    images: [
      'https://example.com/pixel9.jpg',
      'https://example.com/pixel9-back.jpg',
    ],
    description: 'Latest Google flagship.',
    condition: 'New',
    brand: 'Google',
    slug: 'pixel-9',
    category: 'Phones',
    categorySlug: 'phones',
    stock: 15,
    manage_stock: true,
    categories: {
      id: 'cat-1',
      name: 'Phones',
      slug: 'phones',
      parent_id: null,
    },
    ...overrides,
  } as unknown as Product;
}

describe('toRelatedProductsProduct', () => {
  it('maps a fully populated Product to a CartProduct correctly', () => {
    const product = makeProduct();
    const result = toRelatedProductsProduct(product);

    expect(result.id).toBe('42');
    expect(result.merchant_id).toBe('merchant-1');
    expect(result.name).toBe('Pixel 9');
    expect(result.description).toBe('Latest Google flagship.');
    expect(result.status).toBe('active');
    expect(result.price).toBe(250000);
    expect(result.manage_stock).toBe(true);
    expect(result.stock).toBe(15);
    expect(result.image).toBe('https://example.com/pixel9.jpg');
    expect(result.imageLarge).toBe('https://example.com/pixel9.jpg');
    expect(result.imageHint).toBe('Google');
    expect(result.brand).toBe('Google');
    expect(result.slug).toBe('pixel-9');
    expect(result.category).toBe('Phones');
    expect(result.category_slug).toBe('phones');
    expect(result.condition).toBe('new');
    expect(result.gtin).toBe('');
    expect(result.mpn).toBe('');
  });

  it('carries the strict serialized pool for the cart aggregate cap', () => {
    const result = toRelatedProductsProduct(
      makeProduct({
        stock: 1,
        stock_quantity: 1,
        inventory_tracking_policy: 'serialized_strict',
      })
    );

    expect(result.stock).toBe(1);
    expect(result.stock_quantity).toBe(1);
    expect(result.inventory_tracking_policy).toBe('serialized_strict');
  });

  it('omits the strict pool when the source has none', () => {
    const result = toRelatedProductsProduct(makeProduct());

    expect(result.stock_quantity).toBeUndefined();
    expect(result.inventory_tracking_policy).toBeUndefined();
  });

  it('normalizes a null manage_stock row to managed inventory', () => {
    // Legacy rows carry a NULL flag at runtime though the type is boolean.
    const result = toRelatedProductsProduct(
      makeProduct({ manage_stock: null as unknown as boolean })
    );

    expect(result.manage_stock).toBe(true);
  });

  it('maps categories object including optional parent_id', () => {
    const product = makeProduct({
      categories: {
        id: 'cat-2',
        name: 'Smartphones',
        slug: 'smartphones',
        parent_id: 'cat-root',
      },
    });

    const result = toRelatedProductsProduct(product);

    expect(result.categories).toEqual({
      id: 'cat-2',
      name: 'Smartphones',
      slug: 'smartphones',
      parent_id: 'cat-root',
    });
  });

  it('sets categories to null when product has no categories', () => {
    const product = makeProduct({ categories: undefined });

    const result = toRelatedProductsProduct(product);

    expect(result.categories).toBeNull();
  });

  it('uses the first image from images array as primary image', () => {
    const product = makeProduct({
      images: ['https://example.com/first.jpg', 'https://example.com/second.jpg'],
      image: 'https://example.com/fallback.jpg',
    });

    const result = toRelatedProductsProduct(product);

    expect(result.image).toBe('https://example.com/first.jpg');
  });

  it('falls back to product.image when images array is empty or missing', () => {
    const product = makeProduct({ images: undefined, image: 'https://example.com/only.jpg' });

    const result = toRelatedProductsProduct(product);

    expect(result.image).toBe('https://example.com/only.jpg');
  });

  it('falls back to /placeholder.svg when no images are present at all', () => {
    const product = makeProduct({ images: undefined, image: '' });

    // When image is an empty string, the || chain reaches the placeholder
    // Adjust expectation: empty string is falsy so placeholder is used
    const result = toRelatedProductsProduct(product);

    expect(result.image).toBe('/placeholder.svg');
  });

  it('defaults stock to 0 when product.stock is undefined', () => {
    const product = makeProduct({ stock: undefined });

    const result = toRelatedProductsProduct(product);

    expect(result.stock).toBe(0);
  });

  it('parses price from formatted string when rawPrice is absent', () => {
    const product = makeProduct({ rawPrice: undefined, price: '₦75,500' });

    const result = toRelatedProductsProduct(product);

    expect(result.price).toBe(75500);
  });

  it('returns 0 for price when price string is not parseable', () => {
    const product = makeProduct({ rawPrice: undefined, price: 'N/A' });

    const result = toRelatedProductsProduct(product);

    expect(result.price).toBe(0);
  });

  it('falls back to nested category fields when top-level category fields are missing', () => {
    const product = makeProduct({
      category: '',
      categorySlug: '',
      categories: {
        id: 'cat-1',
        name: 'Phones',
        slug: 'phones',
        parent_id: null,
      },
    });

    const result = toRelatedProductsProduct(product);

    expect(result.category).toBe('Phones');
    expect(result.category_slug).toBe('phones');
  });

  it('returns undefined condition for unrecognised condition values', () => {
    const product = makeProduct({ condition: 'New & Used' });

    const result = toRelatedProductsProduct(product);

    expect(result.condition).toBeUndefined();
  });
});
