import {
  type MerchantAnalyticsChartPoint,
  resolveKnownOrderItemProfit,
} from '@baci/shared';
import {
  type AnalyticsOrderItemRow,
  type AnalyticsOrderRow,
  asNumber,
} from '@/lib/merchant-analytics-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

function getChartMode(startDate: Date, endDate: Date) {
  const startDay = new Date(startDate);
  startDay.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(endDate);
  endDay.setUTCHours(0, 0, 0, 0);
  const days = Math.max(
    1,
    Math.floor((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1
  );

  return {
    endDay,
    mode: days <= 31 ? 'day' : days <= 180 ? 'week' : 'month',
    startDay,
  } as const;
}

function normalizeBucketStart(date: Date, mode: 'day' | 'week' | 'month') {
  const normalized = new Date(date);
  if (mode === 'week') {
    normalized.setUTCDate(normalized.getUTCDate() - normalized.getUTCDay());
  } else if (mode === 'month') {
    normalized.setUTCDate(1);
  }
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function getBucketLabel(bucketStart: Date, mode: 'day' | 'week' | 'month') {
  return mode === 'month'
    ? bucketStart.toLocaleDateString('en-US', {
        month: 'short',
        timeZone: 'UTC',
      })
    : bucketStart.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
}

export function buildChartData(
  rows: AnalyticsOrderRow[],
  orderItems: AnalyticsOrderItemRow[],
  startDate: Date,
  endDate: Date
) {
  const { endDay, mode, startDay } = getChartMode(startDate, endDate);
  const buckets = new Map<string, MerchantAnalyticsChartPoint>();

  const cursor = new Date(startDay);
  while (cursor <= endDay) {
    const bucketStart = normalizeBucketStart(cursor, mode);
    const key = bucketStart.toISOString();

    if (!buckets.has(key)) {
      buckets.set(key, {
        day: getBucketLabel(bucketStart, mode),
        orders: 0,
        profit: 0,
        revenue: 0,
        tax: 0,
      });
    }

    if (mode === 'month') {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + (mode === 'week' ? 7 : 1));
    }
  }

  for (const row of rows) {
    const bucket = buckets.get(
      normalizeBucketStart(new Date(row.created_at), mode).toISOString()
    );

    if (!bucket) {
      continue;
    }

    bucket.orders = asNumber(bucket.orders) + 1;
    bucket.revenue += asNumber(row.total);
    bucket.tax = asNumber(bucket.tax) + asNumber(row.tax_amount);
  }

  for (const item of orderItems) {
    const joinedOrder = Array.isArray(item.orders)
      ? item.orders[0]
      : item.orders;
    if (!joinedOrder) {
      continue;
    }

    const bucket = buckets.get(
      normalizeBucketStart(new Date(joinedOrder.created_at), mode).toISOString()
    );
    if (!bucket) {
      continue;
    }

    const quantity = asNumber(item.quantity ?? 1);
    bucket.profit =
      asNumber(bucket.profit) + resolveKnownOrderItemProfit(item, quantity);
  }

  return Array.from(buckets.values());
}
