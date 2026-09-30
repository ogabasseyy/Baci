import { expect, it } from 'vitest';
import { selectHydratedDiscoveryIntent } from './select-hydrated-discovery-intent';
import { getMcpProductStockSummary } from './product-stock-summary';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type Row = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
function row(): Row {
  const product = { id: 'phone', name: 'iPhone 15', category: 'Smartphones', price: 100, has_variants: true };
  return { product, availableOffers: [], basePurchasable: false, stockSummary: getMcpProductStockSummary(product), displayPrice: 100,
    displayCompareAtPrice: null, displayCondition: 'new', variantAttributeValues: ['128GB', 'Red', '256GB', 'Blue'],
    availableVariants: [
      { product_id: 'phone', price_override: 100, attributes: { storage: '128GB', color: 'Red' } },
      { product_id: 'phone', price_override: 200, condition: 'used', attributes: { storage: '256GB', color: 'Blue' } },
    ] };
}
it('prices only the available variant that satisfies the requested attributes', () => {
  const selected = selectHydratedDiscoveryIntent(row(), 'iPhone 15 256GB');
  expect(selected?.displayPrice).toBe(200);
  expect(selected?.displayCondition).toBe('used');
  expect(selected?.availableVariants).toHaveLength(1);
});
it('summarizes stock only for variants satisfying the requested attributes', () => {
  const product = row();
  product.product.manage_stock = true;
  product.availableVariants[0]!.stock_quantity = 11;
  product.availableVariants[1]!.stock_quantity = 1;

  const selected = selectHydratedDiscoveryIntent(product, 'iPhone 15 256GB');

  expect(selected?.availableVariants).toHaveLength(1);
  expect(selected?.stockSummary).toEqual({ confidence: 'low', inStock: true, level: 'Last Units' });
});
it('retains general product pricing when the query does not constrain options', () => {
  expect(selectHydratedDiscoveryIntent(row(), 'iPhone 15')?.displayPrice).toBe(100);
});
it('enforces a single-word option without borrowing unavailable parent claims', () => {
  const product = row();
  product.availableVariants = product.availableVariants.slice(0, 1);
  product.product.name = 'iPhone 15 Blue';
  expect(selectHydratedDiscoveryIntent(product, 'blue')).toBeUndefined();
  expect(selectHydratedDiscoveryIntent(product, 'red')?.displayPrice).toBe(100);
});
