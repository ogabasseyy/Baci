import { describe, expect, it } from 'vitest';
import { aggregateAnalyticsDetail } from '@/hooks/useAnalyticsDetail.aggregate';
import type {
  AnalyticsOrder,
  MetricType,
  OrderItemWithJoins,
} from '@/hooks/useAnalyticsDetail.types';

const order = (
  id: string,
  created_at: string,
  total: number,
  tax_amount = 0
): AnalyticsOrder => ({
  created_at,
  id,
  payment_status: 'paid',
  tax_amount,
  total,
});

const item = (
  created_at: string,
  price: number,
  quantity: number,
  cost_price: number
): OrderItemWithJoins => ({
  orders: {
    branch_id: 'branch-1',
    created_at,
    id: `order-${created_at}`,
    merchant_id: 'merchant-1',
    payment_status: 'paid',
  },
  price,
  products: { cost_price },
  quantity,
});

const itemWithCostFallbacks = (
  created_at: string,
  price: number,
  quantity: number,
  costs: {
    orderItemCostPrice?: number | null;
    productCostPrice?: number | null;
    unitCosts?: Array<{ cost_price: number | null; unit_index: number | null }>;
    variantCostPrice?: number | null;
  }
): OrderItemWithJoins =>
  ({
    cost_price: costs.orderItemCostPrice ?? null,
    orders: {
      branch_id: 'branch-1',
      created_at,
      id: `order-${created_at}`,
      merchant_id: 'merchant-1',
      payment_status: 'paid',
    },
    order_item_unit_costs: costs.unitCosts ?? null,
    price,
    product_variants:
      costs.variantCostPrice === undefined
        ? null
        : { cost_price: costs.variantCostPrice },
    products:
      costs.productCostPrice === undefined
        ? null
        : { cost_price: costs.productCostPrice },
    quantity,
  }) as unknown as OrderItemWithJoins;

function aggregate(
  metric: MetricType,
  orders: AnalyticsOrder[] = [],
  orderItems: OrderItemWithJoins[] = []
) {
  return aggregateAnalyticsDetail({
    granularity: 'month',
    metric,
    orderItems,
    orders,
    timezone: 'UTC',
  });
}

describe('aggregateAnalyticsDetail', () => {
  it('returns zeroed buckets for empty input', () => {
    const result = aggregate('sales');

    expect(result.total).toBe(0);
    expect(result.data).toHaveLength(12);
    expect(result.bestPeriod).toBeNull();
    expect(result.worstPeriod).toBeNull();
  });

  it('aggregates sales, revenue, and VAT into monthly buckets', () => {
    const orders = [
      order('order-1', '2026-01-10T00:00:00.000Z', 100, 7.5),
      order('order-2', '2026-01-11T00:00:00.000Z', 50, 2.5),
      order('order-3', '2026-02-01T00:00:00.000Z', 25, 1),
    ];

    expect(aggregate('sales', orders).total).toBe(3);
    expect(aggregate('revenue', orders).data[0].value).toBe(150);
    expect(aggregate('vat', orders).total).toBe(11);
  });

  it('calculates per-bucket and global AOV with weighted recombination', () => {
    const result = aggregate('aov', [
      order('order-1', '2026-01-10T00:00:00.000Z', 100),
      order('order-2', '2026-01-11T00:00:00.000Z', 50),
      order('order-3', '2026-02-01T00:00:00.000Z', 300),
    ]);

    expect(result.data[0]).toMatchObject({ label: 'Jan', value: 75, count: 2 });
    expect(result.data[1]).toMatchObject({
      label: 'Feb',
      value: 300,
      count: 1,
    });
    expect(result.data[2].value).toBe(0);
    expect(result.total).toBe(150);
  });

  it('uses joined order items for profit and revenue secondary values', () => {
    const orderItems = [
      item('2026-01-10T00:00:00.000Z', 40, 2, 15),
      item('2026-01-11T00:00:00.000Z', 10, 1, 4),
    ];

    const profits = aggregate('profits', [], orderItems);
    expect(profits.data[0]).toMatchObject({
      value: 56,
      secondaryValue: 90,
    });
    expect(profits.total).toBe(56);

    const revenue = aggregate('revenue', [], orderItems);
    expect(revenue.data[0]).toMatchObject({
      value: 0,
      secondaryValue: 56,
    });
  });

  it('prefers order item and variant cost overrides before product defaults', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 2, {
        orderItemCostPrice: 12,
        productCostPrice: 30,
        variantCostPrice: 20,
      }),
      itemWithCostFallbacks('2026-01-11T00:00:00.000Z', 50, 1, {
        orderItemCostPrice: null,
        productCostPrice: 30,
        variantCostPrice: 20,
      }),
      itemWithCostFallbacks('2026-01-12T00:00:00.000Z', 50, 1, {
        orderItemCostPrice: null,
        productCostPrice: 30,
        variantCostPrice: null,
      }),
    ];

    const profits = aggregate('profits', [], orderItems);

    expect(profits.data[0]).toMatchObject({
      value: 126,
      secondaryValue: 200,
    });
    expect(profits.total).toBe(126);
  });

  it('does not aggregate selling price as profit when cost price is missing', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 2, {
        orderItemCostPrice: null,
        productCostPrice: null,
        variantCostPrice: null,
      }),
    ];

    const profits = aggregate('profits', [], orderItems);

    expect(profits.data[0]).toMatchObject({
      value: 0,
      secondaryValue: 100,
    });
    expect(profits.total).toBe(0);
  });

  it('keeps missing-cost selling price out of revenue profit context', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 2, {
        orderItemCostPrice: null,
        productCostPrice: null,
        variantCostPrice: null,
      }),
    ];

    const revenue = aggregate('revenue', [], orderItems);

    expect(revenue.data[0]).toMatchObject({
      value: 0,
      secondaryValue: 0,
    });
  });

  it('counts only known per-unit profit when remaining costs are pending', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 2, {
        orderItemCostPrice: null,
        productCostPrice: null,
        unitCosts: [{ cost_price: 25, unit_index: 0 }],
        variantCostPrice: null,
      }),
    ];

    const profits = aggregate('profits', [], orderItems);

    expect(profits.data[0]).toMatchObject({
      value: 25,
      secondaryValue: 100,
    });
  });

  it('preserves a recorded zero per-unit cost as known profit', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 1, {
        orderItemCostPrice: null,
        productCostPrice: null,
        unitCosts: [{ cost_price: 0, unit_index: 0 }],
        variantCostPrice: null,
      }),
    ];

    expect(aggregate('profits', [], orderItems).total).toBe(50);
  });

  it('ignores fractional unit indexes instead of applying malformed costs', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 1, {
        orderItemCostPrice: null,
        productCostPrice: null,
        unitCosts: [{ cost_price: 10, unit_index: 0.5 }],
        variantCostPrice: null,
      }),
    ];

    expect(aggregate('profits', [], orderItems).total).toBe(0);
  });

  it('preserves a recorded zero quantity instead of counting one unit', () => {
    const orderItems = [
      itemWithCostFallbacks('2026-01-10T00:00:00.000Z', 50, 0, {
        orderItemCostPrice: 10,
      }),
    ];

    const profits = aggregate('profits', [], orderItems);

    expect(profits.data[0]).toMatchObject({ value: 0, secondaryValue: 0 });
    expect(profits.total).toBe(0);
  });

  it('selects best and worst periods from finite bucket values only', () => {
    const result = aggregate('revenue', [
      order('order-1', '2026-01-10T00:00:00.000Z', Number.POSITIVE_INFINITY),
      order('order-2', '2026-02-10T00:00:00.000Z', 10),
      order('order-3', '2026-03-10T00:00:00.000Z', -5),
    ]);

    expect(result.bestPeriod).toMatchObject({ label: 'Feb', value: 10 });
    expect(result.worstPeriod).toMatchObject({ label: 'Mar', value: -5 });
  });

  it('ignores empty buckets when selecting best and worst periods', () => {
    const result = aggregate('revenue', [
      order('order-1', '2026-03-10T00:00:00.000Z', 25),
    ]);

    expect(result.bestPeriod).toMatchObject({ label: 'Mar', value: 25 });
    expect(result.worstPeriod).toMatchObject({ label: 'Mar', value: 25 });
  });
});
