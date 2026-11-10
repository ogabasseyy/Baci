import type { SupabaseClient } from '@supabase/supabase-js';

interface QueryResultLike {
  count?: number | null;
  data: unknown;
  error: { message: string } | null;
}

export interface MerchantAnalyticsQueryResults {
  activeOrdersResult: QueryResultLike;
  blogPostsResult: QueryResultLike;
  currentOrderItemsResult: QueryResultLike;
  currentOrdersResult: QueryResultLike;
  previousOrderItemsResult: QueryResultLike;
  previousOrdersResult: QueryResultLike;
  recentOrdersResult: QueryResultLike;
  supplierAnalyticsResult: QueryResultLike;
}

function applyOrderBranchFilter<Query>(
  query: Query,
  branchId: string | undefined,
  column = 'branch_id'
): Query {
  if (!branchId) {
    return query;
  }

  return (
    query as unknown as { eq: (column: string, value: string) => Query }
  ).eq(column, branchId);
}

/**
 * Returns the raw Supabase result objects so the overview layer can preserve
 * the existing single-point error handling and response shaping behavior.
 */
export async function fetchMerchantAnalyticsData(
  supabase: SupabaseClient,
  merchantId: string,
  startDate: Date,
  endDate: Date,
  previousStart: Date,
  previousEnd: Date,
  branchId?: string
): Promise<MerchantAnalyticsQueryResults> {
  const [
    currentOrdersResult,
    previousOrdersResult,
    currentOrderItemsResult,
    previousOrderItemsResult,
    recentOrdersResult,
    blogPostsResult,
    activeOrdersResult,
    supplierAnalyticsResult,
  ] = await Promise.all([
    // These two queries intentionally include refunded orders so the overview
    // layer can compute refund-rate deltas from the same dataset.
    // Customer fields are used by the overview layer for customer
    // deduplication and customer-breakdown labels.
    applyOrderBranchFilter(
      supabase
        .from('orders')
        .select(
          'id, created_at, customer_email, customer_id, customer_name, discount_amount, payment_method, payment_status, shipping_fee, source, subtotal, tax_amount, total, branch_id'
        )
        .eq('merchant_id', merchantId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString()),
      branchId
    ),
    applyOrderBranchFilter(
      supabase
        .from('orders')
        .select(
          'id, created_at, customer_email, customer_id, customer_name, discount_amount, payment_method, payment_status, shipping_fee, source, subtotal, tax_amount, total, branch_id'
        )
        .eq('merchant_id', merchantId)
        .gte('created_at', previousStart.toISOString())
        .lte('created_at', previousEnd.toISOString()),
      branchId
    ),
    applyOrderBranchFilter(
      supabase
        .from('order_items')
        .select(
          'cost_price, product_id, name, price, quantity, product_variants(cost_price), products:merchant_products(brand, cost_price), order_item_unit_costs(cost_price, unit_index), orders!inner(merchant_id, payment_status, created_at, branch_id)'
        )
        .eq('orders.merchant_id', merchantId)
        .eq('orders.payment_status', 'paid')
        .gte('orders.created_at', startDate.toISOString())
        .lte('orders.created_at', endDate.toISOString()),
      branchId,
      'orders.branch_id'
    ),
    applyOrderBranchFilter(
      supabase
        .from('order_items')
        .select(
          'cost_price, product_id, name, price, quantity, product_variants(cost_price), products:merchant_products(brand, cost_price), order_item_unit_costs(cost_price, unit_index), orders!inner(merchant_id, payment_status, created_at, branch_id)'
        )
        .eq('orders.merchant_id', merchantId)
        .eq('orders.payment_status', 'paid')
        .gte('orders.created_at', previousStart.toISOString())
        .lte('orders.created_at', previousEnd.toISOString()),
      branchId,
      'orders.branch_id'
    ),
    applyOrderBranchFilter(
      supabase
        .from('orders')
        .select(
          'id, created_at, customer_email, customer_name, total, branch_id'
        )
        .eq('merchant_id', merchantId)
        .eq('payment_status', 'paid')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(5),
      branchId
    ),
    supabase
      .from('blog_posts')
      .select('id, title, slug, status, published_at, created_at, view_count')
      .eq('merchant_id', merchantId),
    // This is a last-hour activity pulse from orders, not analytics_events.
    applyOrderBranchFilter(
      supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('merchant_id', merchantId)
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
      branchId
    ),
    supabase.rpc('get_supplier_purchase_analytics', {
      p_branch_id: branchId ?? null,
      p_end_date: endDate.toISOString(),
      p_merchant_id: merchantId,
      p_start_date: startDate.toISOString(),
    }),
  ]);

  return {
    activeOrdersResult,
    blogPostsResult,
    currentOrderItemsResult,
    currentOrdersResult,
    previousOrderItemsResult,
    previousOrdersResult,
    recentOrdersResult,
    supplierAnalyticsResult,
  };
}
