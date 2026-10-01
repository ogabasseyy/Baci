-- A Baci subdomain is a storefront address; a custom-domain certificate is not
-- a launch prerequisite. Keep domain telemetry separate from merchant launch
-- readiness in the platform-admin projection.
CREATE OR REPLACE FUNCTION public.get_admin_merchant_360_v2(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH base AS (
    SELECT public.get_admin_merchant_360(p_merchant_id) AS payload
  ),
  paid_sales AS (
    SELECT
      COUNT(*)::bigint AS paid_orders,
      COUNT(*) FILTER (
        WHERE COALESCE(UPPER(NULLIF(BTRIM(order_row.currency), '')), 'UNK') =
          COALESCE(base.payload ->> 'moneyCurrency', 'UNK')
      )::bigint AS display_currency_paid_orders,
      COUNT(*) FILTER (
        WHERE COALESCE(UPPER(NULLIF(BTRIM(order_row.currency), '')), 'UNK') <>
          COALESCE(base.payload ->> 'moneyCurrency', 'UNK')
      )::bigint AS excluded_non_display_currency_paid_orders,
      COALESCE(SUM(COALESCE(order_row.total, 0)) FILTER (
        WHERE COALESCE(UPPER(NULLIF(BTRIM(order_row.currency), '')), 'UNK') =
          COALESCE(base.payload ->> 'moneyCurrency', 'UNK')
      ), 0)::numeric AS paid_gmv,
      MAX(order_row.created_at) AS last_paid_at
    FROM public.orders AS order_row
    CROSS JOIN base
    WHERE order_row.merchant_id = p_merchant_id
      AND LOWER(COALESCE(NULLIF(BTRIM(order_row.payment_status), ''), 'unknown')) = 'paid'
  ),
  settlement_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE settlement.status IN ('pending', 'processing'))::bigint AS pending_count,
      COUNT(*) FILTER (WHERE settlement.status = 'failed')::bigint AS failed_count,
      COUNT(*) FILTER (WHERE settlement.status = 'settled')::bigint AS settled_count
    FROM public.merchant_settlements AS settlement
    WHERE settlement.merchant_id = p_merchant_id
  )
  SELECT CASE
    WHEN base.payload IS NULL THEN NULL
    ELSE jsonb_set(
      (base.payload - 'sales' - 'settlements'),
      '{readiness,storefrontReady}',
      to_jsonb(
        COALESCE((base.payload -> 'readiness' ->> 'hasStorefrontSlug')::boolean, FALSE)
        AND COALESCE((base.payload -> 'readiness' ->> 'isPublished')::boolean, FALSE)
        AND COALESCE((base.payload -> 'readiness' ->> 'paymentConfigured')::boolean, FALSE)
        AND COALESCE((base.payload -> 'readiness' ->> 'shippingConfigured')::boolean, FALSE)
      )
    ) || jsonb_build_object(
      'sales', jsonb_build_object(
        'paidGmv', paid_sales.paid_gmv,
        'paidOrders', paid_sales.paid_orders,
        'displayCurrencyPaidOrders', paid_sales.display_currency_paid_orders,
        'excludedNonDisplayCurrencyPaidOrders', paid_sales.excluded_non_display_currency_paid_orders,
        'lastPaidAt', paid_sales.last_paid_at
      ),
      'settlements', jsonb_build_object(
        'currency', NULL,
        'pendingAmount', NULL,
        'pendingCount', settlement_counts.pending_count,
        'failedAmount', NULL,
        'failedCount', settlement_counts.failed_count,
        'settledAmount', NULL,
        'settledCount', settlement_counts.settled_count
      )
    )
  END
  FROM base
  CROSS JOIN paid_sales
  CROSS JOIN settlement_counts;
$$;

ALTER FUNCTION public.get_admin_merchant_360_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_360_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_360_v2(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_admin_merchant_360_v2(uuid) IS
  'Platform-admin Merchant 360 v2. Storefront readiness requires a Baci slug, publication, payment, and shipping; custom-domain state remains diagnostic only. Settlement amounts are withheld because the ledger lacks currency.';
