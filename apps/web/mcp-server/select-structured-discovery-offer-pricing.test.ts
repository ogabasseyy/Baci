import { expect, it, vi } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type Row = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
function makeRow(overrides: Record<string, unknown> = {}): Row {
  const product = {
    id: 'phone', name: 'Phone', brand: 'Acme', category: 'Smartphones', price: 500, compare_at_price: 600,
    has_variants: false, has_condition_offers: false, manage_stock: false,
    stock_quantity: 0,
    discovery_metadata: { product_type: 'smartphone', model: 'A1', compatible_with: ['case-x'],
      attributes: { storage_gb: 128, color: 'black' } },
    ...overrides,
  };
  const basePurchasable = typeof overrides.basePurchasable === 'boolean'
    ? overrides.basePurchasable
    : product.has_variants !== true && (product.manage_stock !== true || Number(product.stock_quantity ?? 0) > 0);
  return { product, displayPrice: 500, displayCondition: 'new', displayCompareAtPrice: 600,
    stockSummary: { availability: 'unconfirmed', label: 'Confirm availability' },
    availableVariants: [], variantAttributeValues: [], availableOffers: [], basePurchasable } as unknown as Row;
}

const intent = (alternative: McpDiscoveryIntent['alternatives'][number]): McpDiscoveryIntent => ({ alternatives: [alternative] });

it('sources the selected condition offer compare-at price from the parent like the PDP', () => {
  const row = makeRow({ has_condition_offers: true, manage_stock: true, basePurchasable: false });
  row.availableOffers = [{ price: 450, compare_at_price: 700, condition: 'used', stock_quantity: 2 }] as typeof row.availableOffers;
  Object.assign(row, {
    optionsLookupFailed: true,
    variantLookupFailed: false,
    offerLookupFailed: true,
    variantLookupStatus: 'not_required',
    offerLookupStatus: 'failed',
  });

  const selected = selectStructuredDiscoveryOffer(row, intent({ model: 'A1' }));

  expect(selected).toMatchObject({
    displayPrice: 450,
    displayCompareAtPrice: 600,
    optionsLookupFailed: true,
    variantLookupFailed: false,
    offerLookupFailed: true,
    offerLookupStatus: 'failed',
  });
});

it('falls back to the parent comparison price for overridden variants like the PDP', () => {
  const row = makeRow({ has_variants: true });
  row.availableVariants = [{id: 'blue', product_id: 'phone', attributes: { color: 'blue' }, stock_quantity: 0, price_override: 400}] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({}));
  expect(selected?.displayPrice).toBe(400);
  expect(selected?.displayCompareAtPrice).toBe(600);
  row.availableVariants = [{id: 'blue', product_id: 'phone', attributes: { color: 'blue' }, stock_quantity: 0, price_override: 400, compare_at_price: 450}] as typeof row.availableVariants;
  expect(selectStructuredDiscoveryOffer(row, intent({}))?.displayCompareAtPrice).toBe(450);
});
