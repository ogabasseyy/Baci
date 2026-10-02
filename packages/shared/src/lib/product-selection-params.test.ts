import { describe, expect, it } from 'vitest';
import type { ProductWithSelectionAxesLike } from './product-selection-params';
import {
  extractVariantSelectionParams,
  getDeclaredVariantAxes,
} from './product-selection-params';

const baseProduct: ProductWithSelectionAxesLike = {
  attributeAxes: ['storage', 'connectivity'],
  condition: 'new',
  manage_stock: true,
  price: 550000,
  variant_attributes: {
    storage: ['128GB', '256GB'],
    connectivity: ['WiFi', 'WiFi+Cellular'],
  },
  variants: [
    {
      id: 'variant-new-128',
      condition: 'new',
      stock_quantity: 5,
      attributes: {
        storage: '128GB',
        connectivity: 'WiFi',
      },
    },
    {
      id: 'variant-used-128',
      condition: 'used',
      stock_quantity: 0,
      attributes: {
        storage: '128GB',
        connectivity: 'WiFi',
      },
    },
    {
      id: 'variant-used-256',
      condition: 'used',
      stock_quantity: 3,
      attributes: {
        storage: '256GB',
        connectivity: 'WiFi+Cellular',
      },
    },
  ],
};

describe('product-selection-params', () => {
  it('collects declared axes from the product definition', () => {
    expect(getDeclaredVariantAxes(baseProduct)).toEqual([
      'storage',
      'connectivity',
    ]);
  });

  it('extracts only recognized selection params and ignores unrelated keys', () => {
    const extracted = extractVariantSelectionParams(
      baseProduct,
      new URLSearchParams(
        'utm_source=google&condition=used&storage=256GB&variantId=variant-used-256'
      )
    );

    expect(extracted.variantId).toBe('variant-used-256');
    expect(extracted.condition).toBe('used');
    expect(extracted.attributes).toEqual({ storage: '256GB' });
    expect(extracted.recognizedParamKeys).toEqual([
      'condition',
      'storage',
      'variantId',
    ]);
  });
});
