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
