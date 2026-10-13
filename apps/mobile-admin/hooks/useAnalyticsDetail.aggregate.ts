import { resolveKnownOrderItemProfit } from '@baci/shared';
import {
  type Granularity,
  getBucketIndex,
  getBuckets,
} from '@/hooks/analyticsDetailBuckets';
import {
  type AnalyticsOrder,
  getJoinedRecord,
  type MetricType,
  type OrderItemWithJoins,
  type TimeSeriesDataPoint,
} from '@/hooks/useAnalyticsDetail.types';

interface AggregateAnalyticsDetailArgs {
  granularity: Granularity;
  metric: MetricType;
  orderItems: OrderItemWithJoins[];
  orders: AnalyticsOrder[] | null | undefined;
  timezone: string;
}

export function aggregateAnalyticsDetail({
  granularity,
  metric,
  orderItems,
  orders,
  timezone,
}: AggregateAnalyticsDetailArgs) {
  const buckets = getBuckets(granularity);
  const data: TimeSeriesDataPoint[] = buckets.map((label) => ({
    label,
    value: 0,
    secondaryValue: 0,
    count: 0,
  }));

  orders?.forEach((order) => {
    const date = new Date(order.created_at);
    const bucketIndex = getBucketIndex(date, granularity, timezone);
    if (bucketIndex >= 0 && bucketIndex < data.length) {
      data[bucketIndex].count = (data[bucketIndex].count || 0) + 1;

      switch (metric) {
        case 'revenue':
          data[bucketIndex].value += order.total || 0;
          break;
        case 'sales':
          data[bucketIndex].value += 1;
          break;
        case 'vat':
          data[bucketIndex].value += order.tax_amount || 0;
          break;
        case 'aov':
          data[bucketIndex].value += order.total || 0;
          break;
      }
    }
  });

  if (metric === 'profits' || metric === 'revenue') {
    orderItems.forEach((item) => {
      const order = getJoinedRecord(item.orders);
      if (!order) return;

      const date = new Date(order.created_at);
      const bucketIndex = getBucketIndex(date, granularity, timezone);

      if (bucketIndex >= 0 && bucketIndex < data.length) {
        const quantity = item.quantity ?? 1;
        const revenue = (item.price || 0) * quantity;
        const profit = resolveKnownOrderItemProfit(item, quantity);

        if (metric === 'profits') {
          data[bucketIndex].value += profit;
          data[bucketIndex].secondaryValue =
            (data[bucketIndex].secondaryValue || 0) + revenue;
        } else {
          data[bucketIndex].secondaryValue =
            (data[bucketIndex].secondaryValue || 0) + profit;
        }
      }
    });
  }

  if (metric === 'aov') {
    data.forEach((bucket) => {
      if (bucket.count && bucket.count > 0) {
        bucket.value /= bucket.count;
      }
    });
  }

  const total =
    metric === 'aov'
      ? (() => {
          const totalRevenue = data.reduce(
            (sum, d) => sum + d.value * (d.count || 0),
            0
          );
          const totalCount = data.reduce((sum, d) => sum + (d.count || 0), 0);
          return totalCount > 0 ? totalRevenue / totalCount : 0;
        })()
      : data.reduce((sum, d) => sum + d.value, 0);

  const safeFiniteData = data.filter(
    (d) =>
      Number.isFinite(d.value) &&
      ((d.count ?? 0) > 0 || d.value !== 0 || (d.secondaryValue ?? 0) !== 0)
  );
  const bestPeriod =
    safeFiniteData.length > 0
      ? safeFiniteData.reduce((best, d) => (d.value > best.value ? d : best))
      : null;
  const worstPeriod =
    safeFiniteData.length > 0
      ? safeFiniteData.reduce((worst, d) => (d.value < worst.value ? d : worst))
      : null;

  return {
    data,
    total,
    bestPeriod,
    worstPeriod,
  };
}
