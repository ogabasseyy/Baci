import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import {
  getInitialCriticalVariantSelection,
  getInitialCriticalVariantSelectionPrimaryImage,
  shouldRedirectVariantSelectionParams,
} from './critical-variant-selection';

const variantProduct = {
  condition: 'used',
  has_variants: true,
  id: 'prod-1',
  manage_stock: true,
  price: 800000,
  variants: [
    {
      attributes: { storage: '128GB' },
      condition: 'used',
      id: 'variant-used-128',
      price_override: 750000,
      primary_image: 'https://cdn.example.com/used.avif',
      stock_quantity: 3,
    },
    {
      attributes: { storage: '128GB' },
      condition: 'open_box',
      id: 'variant-open-box-128',
      price_override: 650000,
      primary_image: 'https://cdn.example.com/open-box.avif',
      stock_quantity: 3,
    },
  ],
} as unknown as Product;

describe('critical variant selection helpers', () => {
  it('opens ordinary phone pages on the eligible cellular variant and preserves an explicit restricted selection', () => {
    const product = {
      ...variantProduct,
      name: 'iPhone 16',
      variants: [
        {
          ...variantProduct.variants?.[0],
          id: 'wifi',
          attributes: { sim_type: 'Wi-Fi Only' },
          price_override: 600000,
        },
        {
          ...variantProduct.variants?.[1],
          id: 'cellular',
          attributes: { sim_type: 'Physical + eSIM' },
          price_override: 900000,
        },
      ],
    } as Product;
    expect(getInitialCriticalVariantSelection(product, {})).toHaveProperty(
      'variantId',
      'cellular'
    );
    expect(
      getInitialCriticalVariantSelection(product, { variantId: 'wifi' })
    ).toHaveProperty('variantId', 'wifi');
  });
  it('uses the global lowest-priced variant for no-query critical defaults', () => {
    expect(getInitialCriticalVariantSelection(variantProduct, {})).toEqual({
      attributes: { storage: '128GB' },
      variantId: 'variant-open-box-128',
    });
  });

  it('resolves the initial critical selection primary image from primary_image', () => {
    const selection = getInitialCriticalVariantSelection(variantProduct, {});

    expect(
      getInitialCriticalVariantSelectionPrimaryImage(variantProduct, selection)
    ).toBe('https://cdn.example.com/open-box.avif');
  });

  it('flags ambiguous attribute-only route selections for redirect', () => {
    expect(
      shouldRedirectVariantSelectionParams(variantProduct, { storage: '128GB' })
    ).toBe(true);
  });

  it('does not redirect an unknown exact variant id (client shows missing)', () => {
    expect(
      shouldRedirectVariantSelectionParams(variantProduct, {
        variant_id: 'variant-gone',
      })
    ).toBe(false);
  });
});
