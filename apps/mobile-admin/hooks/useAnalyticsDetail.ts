/**
 * useAnalyticsDetail Hook
 * Fetches time-bucketed analytics data for a specific metric.
 */

import { useQuery } from '@tanstack/react-query';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useMerchant } from '@/hooks/useMerchant';
import {
  applyOrderBranchScope,
  getBranchScopeKey,
} from '@/lib/branch-scope-query';
import { supabase } from '@/lib/supabase';
import { METRIC_CONFIG } from './analyticsDetailMetrics';
import { aggregateAnalyticsDetail } from './useAnalyticsDetail.aggregate';
import { fetchAnalyticsDetailComparison } from './useAnalyticsDetail.comparison';
import type {
  AnalyticsDetailData,
  AnalyticsOrder,
  OrderItemWithJoins,
  UseAnalyticsDetailOptions,
} from './useAnalyticsDetail.types';

export type { Granularity } from '@/hooks/analyticsDetailBuckets';
export type {
  AnalyticsDetailData,
  MetricType,
  TimeSeriesDataPoint,
} from './useAnalyticsDetail.types';
export { METRIC_CONFIG };

function normalizeAnalyticsDateRange(startDate: string, endDate: string) {
  const startDateValue = new Date(startDate);
  const endDateValue = new Date(endDate);

  if (
    Number.isNaN(startDateValue.getTime()) ||
    Number.isNaN(endDateValue.getTime())
  ) {
    throw new Error(
      `Invalid analytics date range: startDate=${startDate}, endDate=${endDate}`
    );
  }

  if (
    endDateValue.getHours() === 0 &&
    endDateValue.getMinutes() === 0 &&
    endDateValue.getSeconds() === 0 &&
    endDateValue.getMilliseconds() === 0
  ) {
    endDateValue.setHours(23, 59, 59, 999);
  }

  return { startDateValue, endDateValue };
}

export function useAnalyticsDetail({
  endDate,
  filterLabel,
  metric,
  granularity,
  startDate,
  includeComparison = false,
}: UseAnalyticsDetailOptions) {
  const { merchant } = useMerchant();
  const { scope } = useBranchScope();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const branchScopeKey = getBranchScopeKey(scope);

  return useQuery<AnalyticsDetailData>({
    queryKey: [
      'analytics-detail',
      merchant?.id,
      metric,
      granularity,
      startDate,
      endDate,
      filterLabel,
      includeComparison,
      timezone,
      branchScopeKey,
    ],
    queryFn: async () => {
      if (!merchant?.id) throw new Error('No merchant found');

      const { startDateValue, endDateValue } = normalizeAnalyticsDateRange(
        startDate,
        endDate
      );

      let ordersQuery = supabase
        .from('orders')
        .select('id, total, tax_amount, payment_status, branch_id, created_at')
        .eq('merchant_id', merchant.id)
        .eq('payment_status', 'paid')
        .gte('created_at', startDateValue.toISOString())
        .lte('created_at', endDateValue.toISOString());
      ordersQuery = applyOrderBranchScope(ordersQuery, scope);

      const needsProfitContext = metric === 'profits' || metric === 'revenue';
      let orderItemsQuery = null;
      if (needsProfitContext) {
        orderItemsQuery = supabase
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
          .eq('orders.merchant_id', merchant.id)
          .eq('orders.payment_status', 'paid')
          .gte('orders.created_at', startDateValue.toISOString())
          .lte('orders.created_at', endDateValue.toISOString());
        orderItemsQuery = applyOrderBranchScope(
          orderItemsQuery,
          scope,
          'orders.branch_id'
        );
      }

      const [
        { data: orders, error: ordersError },
        { data: orderItems, error: orderItemsError },
      ] = await Promise.all([
        ordersQuery,
        orderItemsQuery ?? Promise.resolve({ data: [], error: null }),
      ]);

      if (ordersError) {
        throw new Error(`Failed to fetch orders: ${ordersError.message}`);
      }

      if (orderItemsError) {
        throw new Error(
          `Failed to fetch order items: ${orderItemsError.message}`
        );
      }

      const aggregate = aggregateAnalyticsDetail({
        granularity,
        metric,
        orderItems:
          (orderItems as unknown as OrderItemWithJoins[] | null) ?? [],
        orders: orders as AnalyticsOrder[] | null,
        timezone,
      });

      const comparison = includeComparison
        ? await fetchAnalyticsDetailComparison({
            endDateValue,
            granularity,
            merchantId: merchant.id,
            metric,
            scope,
            startDateValue,
            timezone,
            total: aggregate.total,
          })
        : null;

      return {
        metric,
        granularity,
        rangeLabel: filterLabel,
        total: aggregate.total,
        comparisonTotal: comparison?.comparisonTotal,
        percentChange: comparison?.percentChange,
        data: aggregate.data,
        comparisonData: comparison?.comparisonData,
        bestPeriod: aggregate.bestPeriod
          ? {
              label: aggregate.bestPeriod.label,
              value: aggregate.bestPeriod.value,
            }
          : null,
        worstPeriod: aggregate.worstPeriod
          ? {
              label: aggregate.worstPeriod.label,
              value: aggregate.worstPeriod.value,
            }
          : null,
      };
    },
    enabled: !!merchant?.id,
    staleTime: 1000 * 60 * 5,
  });
}
