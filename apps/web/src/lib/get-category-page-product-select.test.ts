import { describe, expect, it } from 'vitest';
import { getCategoryPageProductSelect } from './get-category-page-product-select';
import { PRODUCT_KEY_SPECS_RELATION_SELECT } from './product-key-specs-select';

function selectedColumns(select: string): string[] {
  return select
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean);
}

describe('getCategoryPageProductSelect', () => {
  it('projects created_at so the category launch carousel can pin the newest arrival', () => {
    expect(selectedColumns(getCategoryPageProductSelect(false))).toContain(
      'created_at'
    );
  });

  it('projects has_condition_offers, manage_stock, and stock for inventory availability checks', () => {
    const columns = selectedColumns(getCategoryPageProductSelect(false));
    expect(columns).toContain('has_condition_offers');
    expect(columns).toContain('manage_stock');
    expect(columns).toContain('stock');
  });

  it('inner-joins product categories for category-scoped pages', () => {
    const select = getCategoryPageProductSelect(true);

    expect(select).toContain(
      'product_categories!inner(categories(name, slug))'
    );
  });

  it('left-joins product categories for unscoped listings', () => {
    const select = getCategoryPageProductSelect(false);

    expect(select).toContain('product_categories(categories(name, slug))');
    expect(select).not.toContain('!inner');
  });

  it('selects explicit columns plus the key-specs relation, never a wildcard', () => {
    const select = getCategoryPageProductSelect(false);

    expect(select).not.toMatch(/(^|[\s,])\*([\s,]|$)/);
    expect(select).toContain(PRODUCT_KEY_SPECS_RELATION_SELECT.trim());
  });
});
