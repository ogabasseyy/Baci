import { describe, expect, it } from 'vitest';
import {
  type AnalyticsOrderItemRow,
  type AnalyticsOrderItemUnitCostRow,
  buildTopEntities,
} from '@/lib/merchant-analytics-utils';

function item(input: {
  costPrice?: number | null;
  price: number;
  productCostPrice?: number | null;
  productId?: string | null;
  quantity: number;
  unitCosts?: AnalyticsOrderItemUnitCostRow[] | null;
  variantCostPrice?: number | null;
}): AnalyticsOrderItemRow {
  return {
    cost_price: input.costPrice ?? null,
    name: 'iPhone 11 Pro',
    order_item_unit_costs: input.unitCosts ?? null,
    orders: null,
    price: input.price,
    product_id: input.productId ?? 'product-1',
    product_variants:
      input.variantCostPrice === undefined
        ? null
        : { cost_price: input.variantCostPrice },
    products: {
      brand: 'Apple',
      cost_price: input.productCostPrice ?? null,
    },
    quantity: input.quantity,
  };
}

describe('merchant analytics utils', () => {
  it('calculates profit from order item, variant, then product cost fallbacks', () => {
    const result = buildTopEntities([
      item({
        costPrice: 12,
        price: 50,
        productCostPrice: 30,
        quantity: 2,
        variantCostPrice: 20,
      }),
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        productId: 'product-2',
        quantity: 1,
        variantCostPrice: 20,
      }),
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        productId: 'product-3',
        quantity: 1,
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(126);
    expect(result.totalUnitsSold).toBe(4);
  });

  it('uses recorded per-unit costs for profit, falling back for unrecorded units', () => {
    // qty 2, product fallback cost 30; unit 0 recorded at 25. Line cost =
    // 25 + (1 remaining * 30) = 55. Revenue 100 → profit 45.
    const result = buildTopEntities([
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        quantity: 2,
        unitCosts: [{ cost_price: 25, unit_index: 0 }],
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(45);
  });

  it('counts Supabase numeric string per-unit costs as recorded costs', () => {
    const result = buildTopEntities([
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        quantity: 2,
        unitCosts: [{ cost_price: '25', unit_index: 0 }],
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(45);
  });

  it('falls back when a per-unit cost row has a null cost price', () => {
    // qty 2, product fallback cost 30. A unit row with null cost is not a
    // recorded cost, so both units fall back to 30 → cost 60, profit 40.
    const result = buildTopEntities([
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        quantity: 2,
        unitCosts: [{ cost_price: null, unit_index: 0 }],
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(40);
  });

  it('ignores out-of-range and duplicate unit-cost rows', () => {
    // qty 2, fallback 30. unit_index 5 is out of range (ignored) and the second
    // unit_index 0 is a duplicate (ignored); only the first unit 0 (cost 30)
    // counts, and the 1 remaining unit falls back to 30 → cost 60, profit 40.
    const result = buildTopEntities([
      item({
        costPrice: null,
        price: 50,
        productCostPrice: 30,
        quantity: 2,
        unitCosts: [
          { cost_price: 999, unit_index: 5 },
          { cost_price: 30, unit_index: 0 },
          { cost_price: 999, unit_index: 0 },
        ],
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(40);
  });

  it('returns empty summaries for an empty item list', () => {
    const result = buildTopEntities([]);

    expect(result).toMatchObject({
      brandBreakdown: [],
      topBrand: null,
      topProducts: [],
      totalProfit: 0,
      totalUnitsSold: 0,
    });
  });

  it('does not count selling price as profit when cost price is missing', () => {
    const result = buildTopEntities([
      item({
        costPrice: null,
        price: 50,
        productCostPrice: null,
        quantity: 2,
        variantCostPrice: null,
      }),
    ]);

    expect(result.totalProfit).toBe(0);
    expect(Number.isFinite(result.totalProfit)).toBe(true);
    expect(result.totalUnitsSold).toBe(2);
  });
});
