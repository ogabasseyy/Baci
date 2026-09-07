import { describe, expect, it } from 'vitest';
import {
  buildAdminOrderGiglProductLookup,
  mapAdminOrderGiglQuoteItems,
} from './admin-order-gigl-quote-items';

describe('admin order gigl quote items', () => {
  it('maps product weights onto order items and builds a product lookup', () => {
    const items = [
      {
        product_id: 'p1',
        product: {
          weight_value: 2,
          weight_unit: 'kg',
          commodity_code: '851712',
        },
      },
      { product_id: null, product: null },
    ];

    expect(mapAdminOrderGiglQuoteItems(items)).toEqual([
      expect.objectContaining({
        product_id: 'p1',
        weight_value: 2,
        weight_unit: 'kg',
      }),
      expect.objectContaining({
        product_id: null,
        weight_value: null,
        weight_unit: null,
      }),
    ]);
    expect(buildAdminOrderGiglProductLookup(items)).toEqual({
      p1: {
        weight_value: 2,
        weight_unit: 'kg',
        commodity_code: '851712',
        dimensions: null,
      },
    });
  });

  it('carries product package dimensions into the admin product lookup', () => {
    const dimensions = { length: 10, width: 8, height: 6, unit: 'cm' };
    const items = [
      {
        product_id: 'p1',
        product: {
          weight_value: 2,
          weight_unit: 'kg',
          commodity_code: '851712',
          dimensions,
        },
      },
    ];

    expect(buildAdminOrderGiglProductLookup(items)).toEqual({
      p1: {
        weight_value: 2,
        weight_unit: 'kg',
        commodity_code: '851712',
        dimensions,
      },
    });
  });
});
