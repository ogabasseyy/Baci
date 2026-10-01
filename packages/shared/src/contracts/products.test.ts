import { describe, expect, it } from 'vitest';
import {
  MOBILE_ADMIN_PRODUCT_COLUMNS,
  MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY,
  WEB_PRODUCT_COLUMNS,
  WEB_PRODUCT_VARIANT_COLUMNS,
  WEB_PRODUCT_WITH_VARIANTS_QUERY,
} from './products';

function tokenizeColumns(columns: string): string[] {
  return columns
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

describe('product column constants', () => {
  it('MOBILE_ADMIN_PRODUCT_COLUMNS is a non-empty string', () => {
    expect(typeof MOBILE_ADMIN_PRODUCT_COLUMNS).toBe('string');
    expect(MOBILE_ADMIN_PRODUCT_COLUMNS.length).toBeGreaterThan(0);
  });

  it('WEB_PRODUCT_COLUMNS is a non-empty string', () => {
    expect(typeof WEB_PRODUCT_COLUMNS).toBe('string');
    expect(WEB_PRODUCT_COLUMNS.length).toBeGreaterThan(0);
  });

  it('WEB_PRODUCT_VARIANT_COLUMNS is a non-empty string', () => {
    expect(typeof WEB_PRODUCT_VARIANT_COLUMNS).toBe('string');
    expect(WEB_PRODUCT_VARIANT_COLUMNS.length).toBeGreaterThan(0);
    expect(tokenizeColumns(WEB_PRODUCT_VARIANT_COLUMNS)).toContain('condition');
    expect(tokenizeColumns(WEB_PRODUCT_VARIANT_COLUMNS)).toContain(
      'is_inventory_anchor'
    );
  });

  it('no constant contains select(*)', () => {
    const allConstants = [
      MOBILE_ADMIN_PRODUCT_COLUMNS,
      MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY,
      WEB_PRODUCT_COLUMNS,
      WEB_PRODUCT_VARIANT_COLUMNS,
      WEB_PRODUCT_WITH_VARIANTS_QUERY,
    ];
    for (const col of allConstants) {
      expect(col).not.toContain('*');
    }
  });

  it('MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY includes base columns and relations', () => {
    expect(MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY).toContain(
      MOBILE_ADMIN_PRODUCT_COLUMNS
    );
    expect(MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY).toContain(
      'categories(name)'
    );
    expect(MOBILE_ADMIN_PRODUCT_WITH_RELATIONS_QUERY).toContain('brands(name)');
  });

  it('WEB_PRODUCT_WITH_VARIANTS_QUERY includes base columns and variant columns', () => {
    expect(WEB_PRODUCT_WITH_VARIANTS_QUERY).toContain(WEB_PRODUCT_COLUMNS);
    expect(WEB_PRODUCT_WITH_VARIANTS_QUERY).toContain(
      'variants:product_variants!product_variants_product_id_fkey('
    );
    expect(WEB_PRODUCT_WITH_VARIANTS_QUERY).toContain(
      WEB_PRODUCT_VARIANT_COLUMNS
    );
  });

  it('MOBILE_ADMIN_PRODUCT_COLUMNS includes essential product fields', () => {
    const mobileTokens = tokenizeColumns(MOBILE_ADMIN_PRODUCT_COLUMNS);
    const essentialFields = [
      'id',
      'name',
      'price',
      'stock_quantity',
      'status',
      'images',
    ];
    for (const field of essentialFields) {
      expect(mobileTokens).toContain(field);
    }
  });

  it('WEB_PRODUCT_COLUMNS includes SEO fields', () => {
    const webTokens = tokenizeColumns(WEB_PRODUCT_COLUMNS);
    const seoFields = [
      'meta_title',
      'meta_description',
      'canonical_url',
      'schema_markup',
    ];
    for (const field of seoFields) {
      expect(webTokens).toContain(field);
    }
  });

  it('WEB_PRODUCT_COLUMNS includes sku_matrix projection fields', () => {
    const webTokens = tokenizeColumns(WEB_PRODUCT_COLUMNS);
    const expectedFields = [
      'variant_model',
      'migration_status',
      'default_variant_id',
      'available_conditions',
      'has_condition_offers',
      'min_variant_price',
      'max_variant_price',
    ];

    expect(webTokens).toEqual(expect.arrayContaining(expectedFields));
  });

  it('WEB_PRODUCT_COLUMNS does not include unsupported production columns', () => {
    const webTokens = tokenizeColumns(WEB_PRODUCT_COLUMNS);

    expect(webTokens).not.toContain('min_order_quantity');
    expect(webTokens).not.toContain('is_active');
    expect(webTokens).not.toContain('image_small');
    expect(webTokens).not.toContain('image_large');
  });
});
