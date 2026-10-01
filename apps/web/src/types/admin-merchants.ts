export interface AdminMerchantHealthRow {
  merchant_id: string;
  storefront_slug?: string | null;
  business_name: string | null;
  email: string | null;
  joined_at: string;
  total_gmv: number | string;
  total_orders: number;
  /** Paid orders omitted from the NGN-only total_gmv because their currency is non-NGN or unknown. */
  excluded_non_ngn_or_unknown_paid_orders: number;
  last_order_date: string | null;
  active_days: number;
  /**
   * Legacy compatibility keys for paid-sales recency:
   * healthy=selling, at_risk=sales quiet, churned=sales dormant, new=no paid sales.
   */
  health_status: 'healthy' | 'at_risk' | 'churned' | 'new';
  total_count?: number;
}

export interface AdminMerchantsResponse {
  data: AdminMerchantHealthRow[];
  generatedAt: string;
  pagination: { limit: number; offset: number; total: number };
}
