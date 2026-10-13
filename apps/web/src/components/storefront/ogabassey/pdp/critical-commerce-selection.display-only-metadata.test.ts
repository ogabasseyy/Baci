import { describe, expect, it } from 'vitest';
import type { ProductVariant } from '@/lib/products';
import { getVariantAxesWithMultipleOptions } from './critical-commerce-selection';

describe('critical commerce display-only metadata axes', () => {
  it('does not require display-only metadata axes even when variants differ', () => {
    const variants = [
      {
        attributes: {
          availability_note: 'Confirm price before checkout',
          notice: 'Ships in 24 hours',
          storage: '128GB',
        },
        id: 'variant-a',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 10,
      },
      {
        attributes: {
          availability_note: 'Call to confirm stock',
          notice: 'Ships in 48 hours',
          storage: '128GB',
        },
        id: 'variant-b',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 8,
      },
    ];

    const axes = getVariantAxesWithMultipleOptions(variants);

    expect(axes).toEqual([]);
  });

  it('still requires visible SKU axes when storage differs across variants', () => {
    const variants: ProductVariant[] = [
      {
        attributes: {
          availability_note: 'Confirm price before checkout',
          storage: '128GB',
        },
        id: 'variant-a',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 10,
      },
      {
        attributes: {
          availability_note: 'Call to confirm stock',
          storage: '256GB',
        },
        id: 'variant-b',
        merchant_id: 'merchant-1',
        product_id: 'product-1',
        stock_quantity: 8,
      },
    ];

    const axes = getVariantAxesWithMultipleOptions(variants);

    expect(axes).toEqual(['storage']);
  });
});
