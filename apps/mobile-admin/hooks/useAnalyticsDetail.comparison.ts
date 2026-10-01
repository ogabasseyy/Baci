import { getPreviousAnalyticsDateRange } from '@/lib/analytics-period';
import { applyOrderBranchScope } from '@/lib/branch-scope-query';
import { supabase } from '@/lib/supabase';
import type { BranchScope } from '@/schemas/branch';
import type { Granularity } from './analyticsDetailBuckets';
import { aggregateAnalyticsDetail } from './useAnalyticsDetail.aggregate';
import type {
  AnalyticsOrder,
  MetricType,
  OrderItemWithJoins,
  TimeSeriesDataPoint,
} from './useAnalyticsDetail.types';

interface FetchAnalyticsDetailComparisonArgs {
  endDateValue: Date;
  granularity: Granularity;
  merchantId: string;
  metric: MetricType;
  scope: BranchScope;
  startDateValue: Date;
  timezone: string;
  total: number;
}

export async function fetchAnalyticsDetailComparison({
  endDateValue,
  granularity,
  merchantId,
  metric,
  scope,
  startDateValue,
  timezone,
  total,
}: FetchAnalyticsDetailComparisonArgs): Promise<{
  comparisonData: TimeSeriesDataPoint[];
  comparisonTotal: number;
  percentChange: number;
}> {
  const previousRange = getPreviousAnalyticsDateRange({
    endDate: endDateValue,
    startDate: startDateValue,
  });
  const prevStartDate = previousRange.startDate;
  const prevEndDate = previousRange.endDate;

  let prevOrdersQuery = supabase
    .from('orders')
    .select('id, total, tax_amount, payment_status, branch_id, created_at')
    .eq('merchant_id', merchantId)
    .eq('payment_status', 'paid')
    .gte('created_at', prevStartDate.toISOString())
    .lte('created_at', prevEndDate.toISOString());
  prevOrdersQuery = applyOrderBranchScope(prevOrdersQuery, scope);

  let prevOrderItems: OrderItemWithJoins[] = [];
  let prevOrders: AnalyticsOrder[] | null = null;

  if (metric === 'profits' || metric === 'revenue') {
    let prevOrderItemsQuery = supabase
      .from('order_items')
      .select(`
        cost_price,
        quantity,
        price,
        order_item_unit_costs(cost_price, unit_index),
        product_variants(cost_price),
        products(cost_price),
        orders!inner(id, merchant_id, payment_status, branch_id, created_at)
      `)
      .eq('orders.merchant_id', merchantId)
      .eq('orders.payment_status', 'paid')
      .gte('orders.created_at', prevStartDate.toISOString())
      .lte('orders.created_at', prevEndDate.toISOString());
    prevOrderItemsQuery = applyOrderBranchScope(
      prevOrderItemsQuery,
      scope,
      'orders.branch_id'
    );

    const [
      { data: profitsOrders, error: prevOrdersError },
      { data: profitsOrderItems, error: prevOrderItemsError },
    ] = await Promise.all([prevOrdersQuery, prevOrderItemsQuery]);

    if (prevOrdersError) {
      throw new Error(
        `Failed to fetch comparison orders: ${prevOrdersError.message}`
      );
    }

    if (prevOrderItemsError) {
      throw new Error(
        `Failed to fetch comparison order items: ${prevOrderItemsError.message}`
      );
    }

    prevOrders = profitsOrders;
    prevOrderItems =
      (profitsOrderItems as unknown as OrderItemWithJoins[] | null) ?? [];
  } else {
    const { data: nonProfitOrders, error: prevOrdersError } =
      await prevOrdersQuery;

    if (prevOrdersError) {
      throw new Error(
        `Failed to fetch comparison orders: ${prevOrdersError.message}`
      );
    }

    prevOrders = nonProfitOrders;
  }

  const comparison = aggregateAnalyticsDetail({
    granularity,
    metric,
    orderItems: prevOrderItems,
    orders: prevOrders,
    timezone,
  });
  const comparisonTotal = comparison.total;
  const percentChange =
    comparisonTotal > 0
      ? ((total - comparisonTotal) / comparisonTotal) * 100
      : total > 0
        ? 100
        : 0;

  return {
    comparisonData: comparison.data,
    comparisonTotal,
    percentChange,
  };
}
