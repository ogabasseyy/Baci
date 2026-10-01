import type { Granularity } from '@/hooks/analyticsDetailBuckets';

export type MetricType = 'revenue' | 'sales' | 'aov' | 'profits' | 'vat';

export interface TimeSeriesDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  count?: number;
}

export interface AnalyticsDetailData {
  metric: MetricType;
  granularity: Granularity;
  rangeLabel: string;
  total: number;
  comparisonTotal?: number;
  percentChange?: number;
  data: TimeSeriesDataPoint[];
  comparisonData?: TimeSeriesDataPoint[];
  bestPeriod: { label: string; value: number } | null;
  worstPeriod: { label: string; value: number } | null;
}

export interface UseAnalyticsDetailOptions {
  metric: MetricType;
  granularity: Granularity;
  startDate: string;
  endDate: string;
  filterLabel: string;
  includeComparison?: boolean;
}

export interface JoinedProduct {
  cost_price: number | null;
}

export interface JoinedVariant {
  cost_price: number | null;
}

export interface JoinedOrder {
  id: string;
  merchant_id: string;
  payment_status: string;
  branch_id?: string | null;
  created_at: string;
}

export interface JoinedOrderItemUnitCost {
  cost_price: number | null;
  unit_index: number | null;
}

export interface OrderItemWithJoins {
  cost_price?: number | null;
  quantity: number | null;
  price: number | null;
  order_item_unit_costs?: JoinedOrderItemUnitCost[] | null;
  product_variants?: JoinedVariant | JoinedVariant[] | null;
  products: JoinedProduct | JoinedProduct[] | null;
  orders: JoinedOrder | JoinedOrder[] | null;
}

export interface AnalyticsOrder {
  id: string;
  total: number | null;
  tax_amount: number | null;
  payment_status: string | null;
  created_at: string;
}

export const getJoinedRecord = <T>(
  value: T | T[] | null | undefined
): T | null => {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
};
