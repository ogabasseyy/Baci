import { describe, expect, it } from 'vitest';
import { matchesHydratedDiscoveryIntent } from './matches-hydrated-discovery-intent';
import { getMcpProductStockSummary } from './product-stock-summary';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type HydratedProduct = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
function fixture(variants = true): HydratedProduct {
  const product = { id: 'phone', name: 'iPhone 15', brand: 'Apple', category: 'Smartphones', price: 100, has_variants: variants, manage_stock: true };
  return { product, stockSummary: getMcpProductStockSummary(product), displayPrice: 100,
    displayCondition: 'new', displayCompareAtPrice: null,
    availableVariants: [
      { product_id: 'phone', attributes: { storage: '256GB', color: 'Blue' }, stock_quantity: 2 },
      { product_id: 'phone', attributes: { storage: '512GB', color: 'Green' }, stock_quantity: 1 },
    ], variantAttributeValues: ['256GB', 'Blue', '512GB', 'Green', 'Red'] };
}
describe('hydrated discovery intent', () => {
  it('matches simple products through their parent identity', () => {
    expect(matchesHydratedDiscoveryIntent(fixture(false), 'iPhone 15')).toBe(true);
    expect(matchesHydratedDiscoveryIntent(fixture(false), 'Samsung phone')).toBe(false);
  });
  it('matches invariant parent identity and each available combination', () => {
    expect(matchesHydratedDiscoveryIntent(fixture(), 'iPhone 15')).toBe(true);
    expect(matchesHydratedDiscoveryIntent(fixture(), 'iPhone 15 256GB blue')).toBe(true);
    expect(matchesHydratedDiscoveryIntent(fixture(), 'iPhone 15 512GB green')).toBe(true);
  });
  it('rejects unavailable options and values borrowed across combinations', () => {
    expect(matchesHydratedDiscoveryIntent(fixture(), 'iPhone 15 256GB green')).toBe(false);
    expect(matchesHydratedDiscoveryIntent(fixture(), 'iPhone 15 512GB red')).toBe(false);
    const row = fixture();
    row.product.name = 'iPhone 15 512GB Red';
    expect(matchesHydratedDiscoveryIntent(row, 'iPhone 15 512GB red')).toBe(false);
  });
  it('does not fabricate option availability when no combinations are known', () => {
    const row = fixture();
    row.availableVariants = [];
    expect(matchesHydratedDiscoveryIntent(row, 'iPhone 15 256GB blue')).toBe(false);
  });
});
