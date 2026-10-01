import { describe, expect, it } from 'vitest';
import { resolveKnownOrderItemProfit } from './order-item-analytics-profit';

function item({
  itemCost = null,
  productCost = null,
  unitCosts = [],
  variantCost = null,
}: {
  itemCost?: number | null;
  productCost?: number | null;
  unitCosts?: Array<{ cost_price: number | null; unit_index: number | null }>;
  variantCost?: number | null;
} = {}) {
  return {
    cost_price: itemCost,
    order_item_unit_costs: unitCosts,
    price: 50,
    product_variants: { cost_price: variantCost },
    products: { cost_price: productCost },
  };
}

describe('resolveKnownOrderItemProfit', () => {
  it('returns zero while every cost source is pending', () => {
    expect(resolveKnownOrderItemProfit(item(), 2)).toBe(0);
  });

  it('shares item, variant, and product fallback precedence', () => {
    expect(
      resolveKnownOrderItemProfit(
        item({ itemCost: 12, productCost: 30, variantCost: 20 }),
        2
      )
    ).toBe(76);
  });

  it('counts known units and leaves remaining pending units at zero profit', () => {
    expect(
      resolveKnownOrderItemProfit(
        item({ unitCosts: [{ cost_price: 25, unit_index: 0 }] }),
        2
      )
    ).toBe(25);
  });

  it('ignores malformed and duplicate unit indexes', () => {
    expect(
      resolveKnownOrderItemProfit(
        item({
          unitCosts: [
            { cost_price: 10, unit_index: 0.5 },
            { cost_price: 20, unit_index: 0 },
            { cost_price: 30, unit_index: 0 },
            { cost_price: 10, unit_index: 2 },
          ],
        }),
        1
      )
    ).toBe(30);
  });

  it('preserves zero costs and zero quantities', () => {
    expect(
      resolveKnownOrderItemProfit(
        item({ unitCosts: [{ cost_price: 0, unit_index: 0 }] }),
        1
      )
    ).toBe(50);
    expect(resolveKnownOrderItemProfit(item({ itemCost: 10 }), 0)).toBe(0);
  });
});
