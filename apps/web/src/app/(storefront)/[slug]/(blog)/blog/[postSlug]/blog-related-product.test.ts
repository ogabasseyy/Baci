import { describe, expect, it } from 'vitest';
import type { BlogRelatedProduct } from './blog-related-product';

describe('BlogRelatedProduct contract', () => {
  it('accepts live pricing and nullable inventory fields', () => {
    const product = {
      id: 'product-1',
      name: 'iPhone 16',
      price: 150000,
      compare_at_price: null,
      min_variant_price: 145000,
      max_variant_price: 155000,
      manage_stock: null,
      stock: 0,
      stock_quantity: null,
      has_condition_offers: true,
      has_variants: true,
      slug: 'iphone-16',
      offers: [{ price: 145000, stock_quantity: 2 }],
      variants: [{ price_override: null, stock_quantity: 1 }],
    } satisfies BlogRelatedProduct;

    expect(product).toMatchObject({
      id: 'product-1',
      min_variant_price: 145000,
      offers: [{ price: 145000 }],
      variants: [{ stock_quantity: 1 }],
    });
  });
});
