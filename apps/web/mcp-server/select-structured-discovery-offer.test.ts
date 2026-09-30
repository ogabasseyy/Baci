import { expect, it } from 'vitest';
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

it('requires one purchasable option to satisfy every attribute constraint', () => {
  const row = makeRow({ has_variants: true });
  row.availableVariants = [
    { product_id: 'phone', attributes: { storage_gb: 256, color: 'red' }, price_override: 400, stock_quantity: 2 },
    { product_id: 'phone', attributes: { storage_gb: 128, color: 'blue' }, price_override: 350, stock_quantity: 2 },
  ] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'blue' },
  ] }));
  expect(selected).toBeUndefined();
});

it('normalizes live variant catalog attributes and narrows returned variants to the selected option', () => {
  const row = makeRow({ has_variants: true, discovery_metadata: {
    product_type: 'smartphone', model: 'A1', attributes: { storage_gb: 128, color: 'black' },
  } });
  row.availableVariants = [
    { id: 'variant-256-blue', product_id: 'phone', attributes: { Storage: '256GB', Colour: 'Blue' }, price_override: 700, stock_quantity: 2 },
    { id: 'variant-512-red', product_id: 'phone', attributes: { Storage: '512GB', Colour: 'Red' }, price_override: 800, stock_quantity: 2 },
  ] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'gte', value: 256 },
    { key: 'color', operator: 'eq', value: 'blue' },
  ] }));
  expect(selected?.displayPrice).toBe(700);
  expect(selected?.selectedOption).toMatchObject({
    kind: 'variant', option_id: 'variant-256-blue', attributes: { storage_gb: 256, color: 'blue' },
  });
  expect(selected?.availableVariants).toHaveLength(1);
  expect(selected?.availableVariants[0]?.id).toBe('variant-256-blue');
});

it('does not inherit a base capacity when a recognized variant override is malformed', () => {
  const row = makeRow({ has_variants: true, discovery_metadata: {
    product_type: 'smartphone', attributes: { storage_gb: 128 },
  } });
  row.availableVariants = [
    { product_id: 'phone', attributes: { Storage: 'up to 256GB' }, price_override: 400, stock_quantity: 1 },
  ] as typeof row.availableVariants;
  expect(selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'gte', value: 128 },
  ] }))).toBeUndefined();
});

it('applies stock eligibility and budget before selecting the cheapest matching option', () => {
  const row = makeRow({ has_variants: true, manage_stock: true });
  row.availableVariants = [
    { product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 100, stock_quantity: 0 },
    { product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 300, stock_quantity: 1 },
    { product_id: 'phone', attributes: { storage_gb: 256 }, price_override: 450, stock_quantity: 1 },
  ] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'storage_gb', operator: 'gte', value: 256 },
  ] }), { min_price: 250, max_price: 400 });
  expect(selected?.displayPrice).toBe(300);
  expect(selected?.selectedOption.kind).toBe('variant');
});

it('allows unmanaged base stock and rejects a managed base option with zero quantity', () => {
  const query = intent({ product_type: 'phone' });
  expect(selectStructuredDiscoveryOffer(makeRow(), query)?.selectedOption.kind).toBe('base');
  expect(selectStructuredDiscoveryOffer(makeRow({ manage_stock: true }), query)).toBeUndefined();
  expect(selectStructuredDiscoveryOffer(makeRow({ manage_stock: true, stock_quantity: 1 }), query)?.displayPrice).toBe(500);
});

it('uses hydrated base eligibility and the base condition rather than the cheapest offer condition', () => {
  const row = makeRow({ condition: 'open_box', basePurchasable: true });
  row.displayCondition = 'used';
  row.availableOffers = [{ price: 450, condition: 'used', stock_quantity: 4 }];
  const selected = selectStructuredDiscoveryOffer(row, intent({ product_type: 'phone' }), { min_price: 500 });
  expect(selected?.displayPrice).toBe(500);
  expect(selected?.displayCondition).toBe('open_box');
  expect(selectStructuredDiscoveryOffer(makeRow({ basePurchasable: false }), intent({ product_type: 'phone' }))).toBeUndefined();
});

it('reports stock for the matched offer instead of unrelated parent or offer inventory', () => {
  const row = makeRow({ has_condition_offers: true, manage_stock: true, stock_quantity: 80, basePurchasable: false });
  row.availableOffers = [{ price: 450, condition: 'used', stock_quantity: 2 }];
  const selected = selectStructuredDiscoveryOffer(row, intent({ model: 'A1' }));
  expect(selected?.stockSummary).toMatchObject({ inStock: true, level: 'Last Units' });
});

it('preserves the selected condition offer compare-at price and lookup state', () => {
  const row = makeRow({ has_condition_offers: true, manage_stock: true, basePurchasable: false });
  row.availableOffers = [{ price: 450, compare_at_price: 600, condition: 'used', stock_quantity: 2 }] as typeof row.availableOffers;
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

it('matches alternatives as complete branches and excludes explicit product types', () => {
  const row = makeRow();
  const selected = selectStructuredDiscoveryOffer(row, {
    alternatives: [
      { product_type: 'tablet' },
      { product_type: 'phone', model: 'A1' },
    ],
  });
  expect(selected?.selectedOption.kind).toBe('base');
  expect(selectStructuredDiscoveryOffer(row, { alternatives: [{ product_type: 'phone' }],
    excluded_product_types: ['phone'] })).toBeUndefined();
});

it('keeps brand identity separate from compatibility and compares exact normalized text', () => {
  const row = makeRow();
  expect(selectStructuredDiscoveryOffer(row, intent({ brands: ['Acme'], compatible_with: 'case-x' }))).toBeDefined();
  expect(selectStructuredDiscoveryOffer(row, intent({ brands: ['case-x'] }))).toBeUndefined();
  expect(selectStructuredDiscoveryOffer(row, intent({ compatible_with: 'case' }))).toBeUndefined();
  expect(selectStructuredDiscoveryOffer(row, intent({ model: 'A' }))).toBeUndefined();
});

it('selects eligible condition offers and keeps unknown metadata from satisfying constraints', () => {
  const offerRow = makeRow({ has_condition_offers: true, manage_stock: true });
  offerRow.availableOffers = [
    { price: 450, condition: 'used', stock_quantity: 0 },
    { price: 550, condition: 'used', stock_quantity: 2 },
  ] as typeof offerRow.availableOffers;
  const selectedOffer = selectStructuredDiscoveryOffer(offerRow, intent({ model: 'A1' }));
  expect(selectedOffer?.displayPrice).toBe(550);
  expect(selectedOffer?.displayCondition).toBe('used');
  expect(selectedOffer?.selectedOption.kind).toBe('offer');

  const unknown = makeRow({ discovery_metadata: { product_type: 'smartphone' } });
  expect(selectStructuredDiscoveryOffer(unknown, intent({ attributes: [
    { key: 'storage_gb', operator: 'gte', value: 1 },
  ] }))).toBeUndefined();
});

it('uses only the explicit narrow category fallback when product type metadata is absent', () => {
  const row = makeRow({ discovery_metadata: { model: 'A1' } });
  expect(selectStructuredDiscoveryOffer(row, intent({ product_type: 'phone' }))).toBeDefined();
  expect(selectStructuredDiscoveryOffer(makeRow({ category: 'Mobile Devices', discovery_metadata: {} }),
    intent({ product_type: 'phone' }))).toBeUndefined();
});

it.each(['smartphone', 'Smartphones', 'phone'])('matches stored %s metadata with canonical phone intent', (productType) => {
  const row = makeRow({ discovery_metadata: { product_type: productType } });
  expect(selectStructuredDiscoveryOffer(row, intent({ product_type: 'phone' }))?.displayPrice).toBe(500);
});
