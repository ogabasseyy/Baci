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

it('matches canonically equivalent Unicode in product identity and text attributes', () => {
  const row = makeRow({
    brand: 'Café',
    discovery_metadata: {
      product_type: 'phone', model: 'Café Pro', compatible_with: ['Café case'],
      attributes: { color: 'Café crème' },
    },
  });
  const selected = selectStructuredDiscoveryOffer(row, intent({
    brands: ['Cafe\u0301'],
    model: 'Cafe\u0301 Pro',
    compatible_with: 'Cafe\u0301 case',
    attributes: [{ key: 'color', operator: 'eq', value: 'Cafe\u0301 cre\u0300me' }],
  }));

  expect(selected?.selectedOption.kind).toBe('base');
});

it('excludes same-condition offers the storefront would not sell through', () => {
  const row = makeRow({ condition: 'new', has_condition_offers: true });
  row.availableOffers = [
    { id: 'new-cheap', price: 400, condition: 'new', stock_quantity: 1 },
    { id: 'used-offer', price: 450, condition: 'used', stock_quantity: 1 },
  ] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({}));
  expect(selected?.selectedOption).toMatchObject({ kind: 'offer', option_id: 'used-offer', price: 450 });
});

it('matches full-width variant text against identical intent values', () => {
  const row = makeRow({ has_variants: true, discovery_metadata: { product_type: 'phone' } });
  row.availableVariants = [{ id: 'v-wide', product_id: 'phone', attributes: { color: '\uFF26\uFF35\uFF2C\uFF2C\uFF37\uFF29\uFF24\uFF34\uFF28' }, price_override: 400 }] as typeof row.availableVariants;
  const selected = selectStructuredDiscoveryOffer(row, intent({ attributes: [
    { key: 'color', operator: 'eq', value: '\uFF26\uFF35\uFF2C\uFF2C\uFF37\uFF29\uFF24\uFF34\uFF28' },
  ] }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'variant', price: 400 });
});

it('treats a missing parent condition as new when excluding same-condition offers', () => {
  const row = makeRow({ condition: null, has_condition_offers: true });
  row.availableOffers = [{ id: 'new-offer', price: 400, condition: 'new', stock_quantity: 1 }] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({}));
  expect(selected?.selectedOption).toMatchObject({ kind: 'base', price: 500 });
});

it('ignores offers when variants own the condition axis', () => {
  const row = makeRow({ has_variants: true, discovery_metadata: { product_type: 'phone' } });
  row.availableVariants = [{ id: 'v-used', product_id: 'phone', condition: 'used', attributes: {}, price_override: 600, stock_quantity: 1 }] as typeof row.availableVariants;
  row.availableOffers = [{ id: 'cheap-offer', price: 400, condition: 'used', stock_quantity: 1 }] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({ product_type: 'phone' }));
  expect(selected?.selectedOption).toMatchObject({ kind: 'variant', price: 600 });
});

it('requires a purchasable variant before selecting an offer', () => {
  const row = makeRow({ has_variants: true, manage_stock: true, discovery_metadata: { product_type: 'phone' } });
  row.availableVariants = [{ id: 'v-oos', product_id: 'phone', attributes: {}, stock_quantity: 0 }] as typeof row.availableVariants;
  row.availableOffers = [{ id: 'offer-1', price: 400, condition: 'used', stock_quantity: 1 }] as typeof row.availableOffers;
  expect(selectStructuredDiscoveryOffer(row, intent({ product_type: 'phone' }))).toBeUndefined();
});

it('resolves duplicate canonical offer conditions to the first row', () => {
  const row = makeRow({ price: 600, has_condition_offers: true });
  row.availableOffers = [
    { id: 'ob-1', price: 500, condition: 'open_box', stock_quantity: 1 },
    { id: 'ob-2', price: 450, condition: 'refurbished', stock_quantity: 1 },
  ] as typeof row.availableOffers;
  const selected = selectStructuredDiscoveryOffer(row, intent({}));
  expect(selected?.selectedOption).toMatchObject({ kind: 'offer', option_id: 'ob-1', price: 500 });
});
