import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { projectChatProduct } from './safe-product-projection';

describe('projectChatProduct', () => {
  it('keeps cart fields and excludes private product and variant fields', () => {
    const product: Product = {
      id: 'product-1',
      merchant_id: 'merchant-1',
      name: 'Phone',
      description: 'Private source description',
      status: 'active',
      slug: 'phone',
      price: 100,
      cost_price: 40,
      sku: 'private-product-sku',
      manage_stock: true,
      stock: 2,
      stock_quantity: 2,
      image: '/phone.jpg',
      imageLarge: '/phone-large.jpg',
      imageHint: 'Phone image',
      brand: 'Example',
      gtin: 'private-gtin',
      mpn: 'private-mpn',
      has_variants: true,
      variants: [
        {
          id: 'variant-1',
          product_id: 'product-1',
          merchant_id: 'merchant-1',
          attributes: { storage: '128GB' },
          price_override: 100,
          stock_quantity: 2,
          cost_price: 35,
          sku: 'private-variant-sku',
        },
      ],
    };

    const projected = projectChatProduct(product);

    expect(projected).toMatchObject({
      id: 'product-1',
      name: 'Phone',
      price: 100,
      manage_stock: true,
      stock: 2,
      has_variants: true,
      variants: [
        {
          id: 'variant-1',
          attributes: { storage: '128GB' },
          price_override: 100,
          stock_quantity: 2,
        },
      ],
    });
    expect(projected.description).toBe('');
    expect(projected).not.toHaveProperty('cost_price');
    expect(projected).not.toHaveProperty('sku');
    expect(projected.gtin).toBe('');
    expect(projected.mpn).toBe('');
    expect(projected.variants?.[0]).not.toHaveProperty('cost_price');
    expect(projected.variants?.[0]).not.toHaveProperty('sku');
  });
});
