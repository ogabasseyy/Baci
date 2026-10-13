import {
  type MerchantAnalyticsNamedValue,
  type MerchantAnalyticsTopProduct,
  resolveKnownOrderItemProfit,
} from '@baci/shared';
import { sanitizeText } from '@/lib/sanitize-core';

export interface AnalyticsOrderRow {
  created_at: string;
  customer_email: string | null;
  customer_id: string | null;
  customer_name: string | null;
  discount_amount: number | null;
  id: string;
  payment_method: string | null;
  payment_status: string | null;
  shipping_fee: number | null;
  source: string | null;
  subtotal: number | null;
  tax_amount: number | null;
  total: number | null;
}

export interface AnalyticsOrderItemUnitCostRow {
  cost_price: number | string | null;
  unit_index: number | null;
}

export interface AnalyticsOrderItemRow {
  cost_price?: number | null;
  name: string | null;
  order_item_unit_costs?: AnalyticsOrderItemUnitCostRow[] | null;
  orders:
    | {
        created_at: string;
      }
    | Array<{
        created_at: string;
      }>
    | null;
  price: number | null;
  product_id: string | null;
  product_variants?:
    | {
        cost_price: number | null;
      }
    | Array<{
        cost_price: number | null;
      }>
    | null;
  products:
    | {
        brand: string | null;
        cost_price: number | null;
      }
    | Array<{
        brand: string | null;
        cost_price: number | null;
      }>
    | null;
  quantity: number | null;
}

export interface BlogPostRow {
  created_at: string;
  id: string;
  published_at: string | null;
  slug: string;
  status: string | null;
  title: string;
  view_count: number | null;
}

export function asNumber(value: number | string | null | undefined) {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return 0;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getJoinedAnalyticsRecord<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export function getPercentChange(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / previous) * 100;
}

function sanitizeBreakdownName(value: unknown) {
  const normalized = String(value ?? 'unknown')
    .trim()
    .toLowerCase();

  const knownLabels: Record<string, string> = {
    bank_transfer: 'Bank transfer',
    banktransfer: 'Bank transfer',
    card: 'Card',
    cash: 'Cash',
    offline: 'Offline',
    online_store: 'Online store',
    pay_on_delivery: 'Pay on delivery',
    pos: 'POS',
    transfer: 'Transfer',
    unknown: 'Unknown',
    wallet: 'Wallet',
    whatsapp: 'WhatsApp',
  };

  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  const withoutControlChars = Array.from(normalized)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');

  const stripped = sanitizeText(withoutControlChars)
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) {
    return 'Unknown';
  }

  return stripped.slice(0, 48);
}

export function groupBreakdown(
  rows: AnalyticsOrderRow[],
  key: keyof AnalyticsOrderRow
) {
  const buckets = new Map<string, number>();

  for (const row of rows) {
    const name = sanitizeBreakdownName(row[key]);
    buckets.set(name, (buckets.get(name) ?? 0) + asNumber(row.total));
  }

  return Array.from(buckets.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);
}

export function buildTopEntities(orderItems: AnalyticsOrderItemRow[]) {
  const products = new Map<string, MerchantAnalyticsTopProduct>();
  const brands = new Map<string, number>();
  let totalProfit = 0;
  let totalUnitsSold = 0;

  for (const item of orderItems) {
    const quantity = asNumber(item.quantity ?? 1);
    const price = asNumber(item.price);
    const revenue = quantity * price;
    const joinedProduct = getJoinedAnalyticsRecord(item.products);
    const brand = joinedProduct?.brand?.trim() || 'Unknown';
    totalProfit += resolveKnownOrderItemProfit(item, quantity);
    totalUnitsSold += quantity;

    if (item.product_id) {
      const current = products.get(item.product_id) ?? {
        id: item.product_id,
        name: sanitizeText(item.name?.trim() || 'Product'),
        revenue: 0,
        units: 0,
      };
      current.revenue += revenue;
      current.units += quantity;
      products.set(item.product_id, current);
    }

    brands.set(brand, (brands.get(brand) ?? 0) + revenue);
  }

  const topProducts = Array.from(products.values()).sort(
    (left, right) => right.revenue - left.revenue
  );
  const topBrandEntry = Array.from(brands.entries()).sort(
    (left, right) => right[1] - left[1]
  )[0];

  return {
    brandBreakdown: Array.from(brands.entries())
      .map(([name, value]) => ({
        name: sanitizeText(name),
        revenue: value,
        value,
      }))
      .sort((left, right) => right.value - left.value),
    topBrand: topBrandEntry
      ? ({
          name: sanitizeText(topBrandEntry[0]),
          revenue: topBrandEntry[1],
          value: topBrandEntry[1],
        } satisfies MerchantAnalyticsNamedValue)
      : null,
    topProducts,
    totalProfit,
    totalUnitsSold,
  };
}

export function buildCustomerBreakdown(orders: AnalyticsOrderRow[]) {
  const customers = new Map<string, MerchantAnalyticsNamedValue>();
  for (const order of orders) {
    const rawName =
      order.customer_name?.trim() ||
      order.customer_email?.trim() ||
      'Guest customer';
    const key = getCustomerAnalyticsKey(order);
    const current = customers.get(key) ?? {
      name: sanitizeText(rawName),
      value: 0,
      revenue: 0,
    };
    current.value += 1;
    current.revenue = asNumber(current.revenue) + asNumber(order.total);
    customers.set(key, current);
  }

  return Array.from(customers.values()).sort((left, right) => {
    if (right.value !== left.value) return right.value - left.value;
    return asNumber(right.revenue) - asNumber(left.revenue);
  });
}

export function getCustomerAnalyticsKey(order: AnalyticsOrderRow) {
  const trimmedEmail = order.customer_email?.trim();
  return order.customer_id ?? (trimmedEmail ? trimmedEmail : 'guest');
}
