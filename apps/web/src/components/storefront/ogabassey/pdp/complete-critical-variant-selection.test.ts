import { describe, expect, it } from 'vitest';
import type { ProductVariant } from '@/lib/products';
import { completeCriticalVariantSelection } from './complete-critical-variant-selection';

const variants: ProductVariant[] = [0, 5].map((stock_quantity, index) => ({
  id: `sku-${index}`,
  product_id: 'laptop',
  merchant_id: 'merchant',
  attributes: { storage: '1TB', ram: index === 0 ? '16GB' : '24GB' },
  condition: 'new',
  price_override: index === 0 ? 2475000 : 2915000,
  stock_quantity,
}));

describe('completeCriticalVariantSelection', () => {
  it('prefers a buyable RAM option when completing storage', () => {
    expect(completeCriticalVariantSelection(
      { price: 2000000, manage_stock: true, variants },
      { storage: '1TB', condition: 'new' },
      ['storage', 'ram', 'condition'], {}
    )).toEqual({ storage: '1TB', ram: '24GB', condition: 'new' });
  });

  it('keeps an explicitly selected sold-out configuration for display', () => {
    expect(completeCriticalVariantSelection(
      { price: 2000000, manage_stock: true, variants },
      { storage: '1TB', ram: '16GB', condition: 'new' },
      ['storage', 'ram', 'condition'], {}
    )).toEqual({ storage: '1TB', ram: '16GB', condition: 'new' });
  });

  it('does not replace an invalid combination with an unrelated SKU', () => {
    const attributes = { storage: '2TB', condition: 'new' };
    expect(completeCriticalVariantSelection(
      { price: 2000000, manage_stock: true, variants },
      attributes, ['storage', 'ram', 'condition'], {}
    )).toEqual(attributes);
  });
});
