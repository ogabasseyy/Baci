import { describe, expect, it } from 'vitest';
import {
  PRODUCT_PROJECTION,
  VARIANT_PROJECTION,
} from './prize-product-projections';

describe('prize product projections', () => {
  it('selects every column the product row mapper requires', () => {
    const columns = PRODUCT_PROJECTION.split(',').map((column) =>
      column.trim()
    );
    for (const column of [
      'id',
      'merchant_id',
      'name',
      'price',
      'images',
      'condition',
      'default_variant_id',
      'has_variants',
      'manage_stock',
      'stock',
      'stock_quantity',
    ]) {
      expect(columns).toContain(column);
    }
  });

  it('selects every column the variant row mapper requires', () => {
    const columns = VARIANT_PROJECTION.split(',').map((column) =>
      column.trim()
    );
    for (const column of [
      'id',
      'merchant_id',
      'product_id',
      'attributes',
      'condition',
      'created_at',
      'price_override',
      'stock_quantity',
      'primary_image',
      'images',
      'sku',
    ]) {
      expect(columns).toContain(column);
    }
  });
});
