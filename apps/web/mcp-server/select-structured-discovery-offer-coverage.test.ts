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
