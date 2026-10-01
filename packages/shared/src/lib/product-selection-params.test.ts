import { describe, expect, it } from 'vitest';
import type { ProductWithSelectionAxesLike } from './product-selection-params';
import {
  extractVariantSelectionParams,
  getDeclaredVariantAxes,
  resolveVariantSelectionParamResolution,
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

  it('resolves variantId matches while retaining the condition param', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams(
        'variantId=variant-used-256&condition=new&storage=128GB'
      )
    );

    expect(resolution.type).toBe('variant_id');
    expect(resolution.matches.map((match) => match.id)).toEqual([
      'variant-used-256',
    ]);
    expect(resolution.selectionInput).toEqual({
      condition: 'new',
      variantId: 'variant-used-256',
    });
  });

  it('retains the condition param when the variantId is invalid', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams('variantId=variant-missing&condition=used')
    );

    expect(resolution.type).toBe('invalid_variant_id');
    expect(resolution.matches).toHaveLength(0);
    expect(resolution.selectionInput).toEqual({
      condition: 'used',
      variantId: 'variant-missing',
    });
  });

  it('treats condition-only params as a valid fallback', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams('condition=used')
    );

    expect(resolution.type).toBe('condition_only');
    expect(resolution.selectionInput).toEqual({ condition: 'used' });
    expect(resolution.matches).toHaveLength(2);
  });

  it('requires condition plus attributes to resolve uniquely', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams(
        'condition=used&storage=256GB&connectivity=WiFi%2BCellular'
      )
    );

    expect(resolution.type).toBe('condition_with_attributes');
    expect(resolution.selectionInput).toEqual({
      condition: 'used',
      attributes: {
        connectivity: 'WiFi+Cellular',
        storage: '256GB',
      },
    });
  });

  it('flags attribute-only deep links as invalid selection routes', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams('storage=128GB')
    );

    expect(resolution.type).toBe('attribute_only');
    expect(resolution.selectionInput).toEqual({
      attributes: {
        storage: '128GB',
      },
    });
  });

  it('returns zero_match when condition params do not resolve a variant', () => {
    const resolution = resolveVariantSelectionParamResolution(
      baseProduct,
      new URLSearchParams('condition=refurbished&storage=256GB')
    );

    expect(resolution.type).toBe('zero_match');
  });

  it('returns ambiguous when condition and attributes still match multiple variants', () => {
    const productWithDuplicate: ProductWithSelectionAxesLike = {
      ...baseProduct,
      variants: [
        ...(baseProduct.variants || []),
        {
          id: 'variant-used-256-duplicate',
          condition: 'used',
          stock_quantity: 1,
          attributes: {
            storage: '256GB',
            connectivity: 'WiFi+Cellular',
          },
        },
      ],
    };

    const resolution = resolveVariantSelectionParamResolution(
      productWithDuplicate,
      new URLSearchParams(
        'condition=used&storage=256GB&connectivity=WiFi%2BCellular'
      )
    );

    expect(resolution.type).toBe('ambiguous');
  });
});
