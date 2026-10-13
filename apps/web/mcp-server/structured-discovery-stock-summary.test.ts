import { describe, expect, it } from 'vitest';
import { getStructuredDiscoveryStockSummary } from './structured-discovery-stock-summary';

describe('getStructuredDiscoveryStockSummary', () => {
  it('inherits parent stock for a paired variant with null quantity', () => {
    const summary = getStructuredDiscoveryStockSummary({
      product: { manage_stock: true, stock_quantity: 5 },
      parentStock: { manage_stock: true, stock_quantity: 5 },
      kind: 'offer',
      pairedVariant: { stock_quantity: null },
      selectedStockQuantity: null,
    });
    expect(summary).toMatchObject({ inStock: true, level: 'Last Units' });
  });

  it('enforces serialized strict stock even when the parent is unmanaged', () => {
    const summary = getStructuredDiscoveryStockSummary({
      product: { manage_stock: false },
      parentStock: { manage_stock: false, stock_quantity: 0 },
      kind: 'variant',
      selectedPolicy: 'serialized_strict',
      selectedStockQuantity: 0,
    });
    expect(summary).toMatchObject({ inStock: false, level: 'Out of Stock' });
  });
});
