import { expect, it } from 'vitest';
import type { McpDiscoveryIntent } from '../src/schemas/mcp-discovery-intent';
import { selectStructuredDiscoveryOffer } from './select-structured-discovery-offer';
import type { hydrateSearchProductAvailability } from './search-product-availability';

type Row = Awaited<ReturnType<typeof hydrateSearchProductAvailability>>[number];
function makeRow(overrides: Record<string, unknown> = {}): Row {
  const product = {
    id: 'phone', name: 'Phone', brand: 'Acme', category: 'Smartphones', price: 500,
    has_variants: true, has_condition_offers: false, manage_stock: true,
    stock_quantity: 5,
    discovery_metadata: { product_type: 'smartphone', attributes: { storage_gb: 128 } },
    ...overrides,
  };
  return { product, displayPrice: 500, displayCondition: 'new',
    stockSummary: { inStock: null },
    availableVariants: [], variantAttributeValues: [], availableOffers: [], basePurchasable: false } as unknown as Row;
}

const intent = (alternative: McpDiscoveryIntent['alternatives'][number]): McpDiscoveryIntent => ({ alternatives: [alternative] });

it('summarizes a null-stock direct variant match as in stock from the parent', () => {
  const row = makeRow();
  row.availableVariants = [
    { id: 'variant-256', product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 700, stock_quantity: null },
  ] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'eq', value: 256 },
  ] }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'variant', option_id: 'variant-256' });
  expect(selected?.stockSummary).toMatchObject({ inStock: true });
});

it('reports a strict serialized match as managed under an unmanaged parent', () => {
  const row = makeRow({ manage_stock: false, stock_quantity: 0 });
  row.availableVariants = [
    { id: 'variant-strict', product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 700,
      stock_quantity: 3, effective_policy: 'serialized_strict' },
  ] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'eq', value: 256 },
  ] }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'variant', option_id: 'variant-strict' });
  expect(selected?.stockSummary).toMatchObject({ inStock: true });
});

it('summarizes a paired offer through the null-stock variant parent fallback', () => {
  const row = makeRow({ has_condition_offers: true });
  row.allVariants = [
    { id: 'variant-256', product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 700, stock_quantity: null },
  ] as unknown as typeof row.availableVariants;
  row.availableVariants = [];
  row.availableOffers = [
    { id: 'used-1', price: 450, condition: 'used', stock_quantity: 1 },
  ] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'eq', value: 256 },
  ] }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'offer', option_id: 'used-1' });
  expect(selected?.stockSummary).toMatchObject({ inStock: true });
});

it('rejects a zero-stock bare offer under null stock management like the PDP', () => {
  const row = makeRow({ has_variants: false, has_condition_offers: true,
    manage_stock: null, stock_quantity: 0 });
  row.availableOffers = [
    { id: 'used-1', price: 450, condition: 'used', stock_quantity: 0 },
  ] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'eq', value: 128 },
  ] }));
  expect(selected).toBeUndefined();
});

it('admits a stocked bare offer under null stock management', () => {
  const row = makeRow({ has_variants: false, has_condition_offers: true,
    manage_stock: null, stock_quantity: 0 });
  row.availableOffers = [
    { id: 'used-1', price: 450, condition: 'used', stock_quantity: 2 },
  ] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'eq', value: 128 },
  ] }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'offer', option_id: 'used-1' });
});
