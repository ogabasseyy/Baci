import type postgres from 'postgres';
import type {
  HarnessAnalyticsSummary,
  HarnessGrantContext,
  HarnessInventoryLevel,
  HarnessOrderRow,
} from './gateway-types';

interface OrderRow {
  id: string;
  merchant_id: string;
  branch_id: string | null;
  payment_status: string;
  shipping_status: string;
  created_at: string | Date;
}

function toOrderRow(row: OrderRow): HarnessOrderRow {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    branchId: row.branch_id,
    paymentStatus: row.payment_status,
    shippingStatus: row.shipping_status,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function readOrdersList(
  txn: postgres.TransactionSql,
  context: HarnessGrantContext,
  branchIds: string[] | null,
  limit: number
): Promise<HarnessOrderRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
  // A non-empty branch selector narrows even merchant-wide reads; only an
  // omitted (or empty) selector scans the whole merchant.
  if (context.merchantWide && (branchIds === null || branchIds.length === 0)) {
    const rows = (await txn`
      SELECT id, merchant_id, branch_id, payment_status, shipping_status, created_at
      FROM public.orders
      WHERE merchant_id = ${context.merchantId}
      ORDER BY created_at DESC
      LIMIT ${bounded}
    `) as unknown as OrderRow[];
    return rows.map(toOrderRow);
  }
  if (context.merchantWide && branchIds !== null) {
    const rows = (await txn`
      SELECT id, merchant_id, branch_id, payment_status, shipping_status, created_at
      FROM public.orders
      WHERE merchant_id = ${context.merchantId}
        AND branch_id = ANY (${branchIds}::uuid[])
      ORDER BY created_at DESC
      LIMIT ${bounded}
    `) as unknown as OrderRow[];
    return rows.map(toOrderRow);
  }
  const effective = branchIds ?? context.branchIds;
  const rows = (await txn`
    SELECT id, merchant_id, branch_id, payment_status, shipping_status, created_at
    FROM public.orders
    WHERE merchant_id = ${context.merchantId}
      AND branch_id = ANY (${effective}::uuid[])
    ORDER BY created_at DESC
    LIMIT ${bounded}
  `) as unknown as OrderRow[];
  return rows.map(toOrderRow);
}

export async function readOrderGet(
  txn: postgres.TransactionSql,
  context: HarnessGrantContext,
  orderId: string
): Promise<HarnessOrderRow | null> {
  const rows = context.merchantWide
    ? ((await txn`
      SELECT id, merchant_id, branch_id, payment_status, shipping_status, created_at
      FROM public.orders
      WHERE id = ${orderId} AND merchant_id = ${context.merchantId}
    `) as unknown as OrderRow[])
    : ((await txn`
      SELECT id, merchant_id, branch_id, payment_status, shipping_status, created_at
      FROM public.orders
      WHERE id = ${orderId}
        AND merchant_id = ${context.merchantId}
        AND branch_id = ANY (${context.branchIds}::uuid[])
    `) as unknown as OrderRow[]);
  const row = rows[0];
  return row ? toOrderRow(row) : null;
}

/**
 * Resolve the branch filter for inventory/analytics reads. Merchant-wide
 * grants scan the whole merchant when the selector is omitted (or empty)
 * and narrow to the selector otherwise; branch-scoped grants narrow to the
 * selector when present and to the grant allowlist when omitted. A NULL
 * filter means "whole merchant" in the queries below.
 */
function effectiveBranchFilter(
  context: HarnessGrantContext,
  branchIds: string[] | null
): string[] | null {
  const selector =
    branchIds === null || branchIds.length === 0 ? null : branchIds;
  if (context.merchantWide) {
    return selector;
  }
  return selector ?? context.branchIds;
}

interface InventoryLevelRow {
  variant_id: string;
  sku: string | null;
  branch_id: string | null;
  available: number;
  reserved: number;
  sold: number;
  threshold: number | null;
}

function toInventoryLevel(row: InventoryLevelRow): HarnessInventoryLevel {
  const threshold = row.threshold ?? 5;
  return {
    variantId: row.variant_id,
    sku: row.sku,
    branchId: row.branch_id,
    available: row.available,
    reserved: row.reserved,
    sold: row.sold,
    lowStock: row.available > 0 && row.available <= threshold,
    outOfStock: row.available === 0,
  };
}

/**
 * Aggregate serialized inventory units per (variant, branch) through RLS.
 * Thresholds come from the linked product row (default 5 when the join is
 * RLS-hidden); joins degrade to NULL rather than leaking hidden rows.
 */
export async function readInventoryLevels(
  txn: postgres.TransactionSql,
  context: HarnessGrantContext,
  branchIds: string[] | null,
  limit: number
): Promise<HarnessInventoryLevel[]> {
  const bounded = Math.min(Math.max(Math.trunc(limit) || 20, 1), 50);
  const filter = effectiveBranchFilter(context, branchIds);
  const rows = (await txn`
    SELECT vi.variant_id, pv.sku, vi.branch_id,
      COUNT(*) FILTER (WHERE vi.status = 'available')::int AS available,
      COUNT(*) FILTER (WHERE vi.status = 'reserved')::int AS reserved,
      COUNT(*) FILTER (WHERE vi.status = 'sold')::int AS sold,
      MAX(p.low_stock_threshold)::int AS threshold
    FROM public.variant_inventory vi
    LEFT JOIN public.product_variants pv ON pv.id = vi.variant_id
    LEFT JOIN public.products p ON p.id = pv.product_id
    WHERE vi.merchant_id = ${context.merchantId}
      AND (${filter}::uuid[] IS NULL OR vi.branch_id = ANY (${filter}::uuid[]))
    GROUP BY vi.variant_id, vi.branch_id, pv.sku, p.low_stock_threshold
    ORDER BY vi.branch_id NULLS LAST, vi.variant_id
    LIMIT ${bounded}
  `) as unknown as InventoryLevelRow[];
  return rows.map(toInventoryLevel);
}

interface OrdersAggregateRow {
  currency: string | null;
  count: number;
  paidCount: number;
  paidRevenue: number;
}

interface ShippingBreakdownRow {
  status: string;
  count: number;
}

interface StockAggregateRow {
  availableUnits: number;
  lowStockLevels: number;
  outOfStockLevels: number;
}

/**
 * Branch-scoped sales and stock aggregates through RLS. Every subquery
 * carries the same merchant/branch filter, so excluded branches (and other
 * merchants) never contribute. Payment and shipping stay separate fields.
 */
export async function readAnalyticsSummary(
  txn: postgres.TransactionSql,
  context: HarnessGrantContext,
  branchIds: string[] | null
): Promise<HarnessAnalyticsSummary> {
  const filter = effectiveBranchFilter(context, branchIds);
  const orderRows = (await txn`
    SELECT NULLIF(UPPER(TRIM(currency)), '') AS currency, COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS "paidCount",
      COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid'), 0)::float8 AS "paidRevenue"
    FROM public.orders
    WHERE merchant_id = ${context.merchantId}
      AND (${filter}::uuid[] IS NULL OR branch_id = ANY (${filter}::uuid[]))
    GROUP BY NULLIF(UPPER(TRIM(currency)), '')
    ORDER BY currency NULLS LAST
  `) as unknown as OrdersAggregateRow[];
  const shippingRows = (await txn`
    SELECT shipping_status AS status, COUNT(*)::int AS count
    FROM public.orders
    WHERE merchant_id = ${context.merchantId}
      AND (${filter}::uuid[] IS NULL OR branch_id = ANY (${filter}::uuid[]))
    GROUP BY shipping_status
    ORDER BY shipping_status
  `) as unknown as ShippingBreakdownRow[];
  const stockRows = (await txn`
    SELECT COALESCE(SUM(available), 0)::int AS "availableUnits",
      COUNT(*) FILTER (WHERE available > 0 AND available <= threshold)::int AS "lowStockLevels",
      COUNT(*) FILTER (WHERE available = 0)::int AS "outOfStockLevels"
    FROM (
      SELECT COUNT(*) FILTER (WHERE vi.status = 'available')::int AS available,
        COALESCE(MAX(p.low_stock_threshold), 5)::int AS threshold
      FROM public.variant_inventory vi
      LEFT JOIN public.product_variants pv ON pv.id = vi.variant_id
      LEFT JOIN public.products p ON p.id = pv.product_id
      WHERE vi.merchant_id = ${context.merchantId}
        AND (${filter}::uuid[] IS NULL OR vi.branch_id = ANY (${filter}::uuid[]))
      GROUP BY vi.variant_id, vi.branch_id
    ) levels
  `) as unknown as StockAggregateRow[];
  const paidRevenueByCurrency = orderRows
    .filter((row) => row.paidCount > 0)
    .map((row) => ({ currency: row.currency, amount: row.paidRevenue }));
  const singleCurrency =
    paidRevenueByCurrency.length === 1 &&
    paidRevenueByCurrency[0].currency !== null
      ? paidRevenueByCurrency[0]
      : null;
  const stock = stockRows[0] ?? {
    availableUnits: 0,
    lowStockLevels: 0,
    outOfStockLevels: 0,
  };
  return {
    orders: {
      count: orderRows.reduce((sum, row) => sum + row.count, 0),
      paidCount: orderRows.reduce((sum, row) => sum + row.paidCount, 0),
      paidRevenue:
        singleCurrency?.amount ??
        (paidRevenueByCurrency.length === 0 ? 0 : null),
      currency: singleCurrency?.currency ?? null,
      paidRevenueByCurrency,
      byShippingStatus: shippingRows.map((row) => ({
        status: row.status,
        count: row.count,
      })),
    },
    stock: {
      availableUnits: stock.availableUnits,
      lowStockLevels: stock.lowStockLevels,
      outOfStockLevels: stock.outOfStockLevels,
    },
  };
}
