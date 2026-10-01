import { describe, expect, it } from 'vitest';
import { buildChartData } from '@/lib/merchant-analytics-chart';
import type {
  AnalyticsOrderItemRow,
  AnalyticsOrderRow,
} from '@/lib/merchant-analytics-utils';

const order: AnalyticsOrderRow = {
  created_at: '2026-05-10T12:00:00.000Z',
  customer_email: null,
  customer_id: null,
  customer_name: null,
  discount_amount: null,
  id: 'order-1',
  payment_method: null,
  payment_status: 'paid',
  shipping_fee: null,
  source: null,
  subtotal: null,
  tax_amount: 0,
  total: 200,
};

function item(input: {
  costPrice?: number | null;
  price: number;
  productCostPrice?: number | null;
  quantity: number;
  unitCosts?: AnalyticsOrderItemRow['order_item_unit_costs'];
  variantCostPrice?: number | null;
}): AnalyticsOrderItemRow {
  return {
    cost_price: input.costPrice ?? null,
    name: 'iPhone 11 Pro',
    orders: { created_at: order.created_at },
    price: input.price,
    product_id: 'product-1',
    product_variants:
      input.variantCostPrice === undefined
        ? null
        : { cost_price: input.variantCostPrice },
    products: {
      brand: 'Apple',
      cost_price: input.productCostPrice ?? null,
    },
    quantity: input.quantity,
    order_item_unit_costs: input.unitCosts ?? null,
  };
}

describe('merchant analytics chart', () => {
  it('builds profit from order item, variant, then product cost fallbacks', () => {
    const [point] = buildChartData(
      [order],
      [
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
          quantity: 1,
          variantCostPrice: 20,
        }),
        item({
          costPrice: null,
          price: 50,
          productCostPrice: 30,
          quantity: 1,
          variantCostPrice: null,
        }),
      ],
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-10T23:59:59.999Z')
    );

    expect(point).toMatchObject({
      day: 'May 10',
      profit: 126,
      revenue: 200,
    });
  });

  it('builds profit from per-unit costs when order item unit costs are present', () => {
    const [point] = buildChartData(
      [{ ...order, total: 300 }],
      [
        item({
          costPrice: 40,
          price: 100,
          productCostPrice: 30,
          quantity: 3,
          unitCosts: [
            { cost_price: 70, unit_index: 0 },
            { cost_price: 30, unit_index: 2 },
          ],
          variantCostPrice: 20,
        }),
      ],
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-10T23:59:59.999Z')
    );

    expect(point).toMatchObject({
      day: 'May 10',
      profit: 160,
      revenue: 300,
    });
  });

  it('returns a zero-profit bucket when orders have no item rows', () => {
    const [point] = buildChartData(
      [order],
      [],
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-10T23:59:59.999Z')
    );

    expect(point).toMatchObject({
      day: 'May 10',
      orders: 1,
      profit: 0,
      revenue: 200,
    });
  });

  it('does not chart selling price as profit when cost price is missing', () => {
    const [point] = buildChartData(
      [order],
      [
        item({
          costPrice: null,
          price: 100,
          productCostPrice: null,
          quantity: 2,
          variantCostPrice: null,
        }),
      ],
      new Date('2026-05-10T00:00:00.000Z'),
      new Date('2026-05-10T23:59:59.999Z')
    );

    expect(point).toMatchObject({ profit: 0, revenue: 200 });
  });
});
