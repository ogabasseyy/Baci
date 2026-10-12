import { describe, expect, it } from '@jest/globals';
import type { Product } from '@/types/product';
import { getSavingsDeviceRows } from './savings-device-rows';
import { hasSelectableVariants } from './start-savings-controller.utils';

const product: Product = {
  condition: 'Used',
  id: 'product-1',
  image: 'https://cdn.example.com/iphone.jpg',
  name: 'iPhone 15 Pro',
  price: 700000,
  slug: 'iphone-15-pro',
  variants: [
    {
      attributes: { storage: '256GB' },
      condition: 'used',
      id: 'variant-256',
      image: 'https://cdn.example.com/iphone-256.jpg',
      name: '256GB',
      price: 850000,
    },
    {
      attributes: { storage: '0GB' },
      id: 'variant-invalid',
      name: 'invalid',
      price: 0,
    },
  ],
};

describe('getSavingsDeviceRows', () => {
  it('does not offer a default device when all actual variants have invalid prices', () => {
    expect(
      getSavingsDeviceRows({
        ...product,
        variants: product.variants?.filter((variant) => variant.price === 0),
      })
    ).toEqual([]);
  });

  it('expands eligible variants into exact device rows', () => {
    expect(hasSelectableVariants(product)).toBe(true);
    expect(getSavingsDeviceRows(product)).toEqual([
      expect.objectContaining({
        price: 850000,
        variantId: 'variant-256',
        variantLabel: 'Storage: 256GB',
      }),
    ]);
  });

  it('keeps a single product row when there are no variants', () => {
    const simpleProduct: Product = {
      ...product,
      variants: [],
    };

    expect(hasSelectableVariants(simpleProduct)).toBe(false);
    expect(getSavingsDeviceRows(simpleProduct)).toEqual([
      expect.objectContaining({
        price: 700000,
        variantId: null,
      }),
    ]);
  });
});
