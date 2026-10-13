-- Live summary metrics for the platform-admin analytics RPC. The public
-- wrapper is installed after its bounded breakdown helpers.

BEGIN;

-- No ordinary indexes are created here: orders and auth audit logs are hot
-- production tables. Any index must be justified with production query plans
-- and introduced separately with a non-blocking concurrent build.

CREATE OR REPLACE FUNCTION private.get_admin_platform_analytics_summary_v1(
  p_period text,
  p_now timestamptz,
  p_start_at timestamptz,
  p_previous_start_at timestamptz,
  p_previous_end_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH
  current_orders AS MATERIALIZED (
    SELECT
      o.merchant_id,
      COALESCE(o.total, 0)::numeric AS total,
      LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) AS payment_status,
      UPPER(NULLIF(BTRIM(o.currency), '')) AS currency
    FROM public.orders o
    WHERE o.created_at >= p_start_at
      AND o.created_at < p_now
  ),
  current_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE currency = 'NGN')::bigint AS gross_orders,
      COALESCE(SUM(total) FILTER (WHERE currency = 'NGN'), 0)::numeric AS gross_gmv,
      COUNT(*) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid')::bigint AS paid_orders,
      COALESCE(SUM(total) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid'), 0)::numeric AS paid_gmv,
      COUNT(DISTINCT merchant_id) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid')::bigint AS selling_merchants,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN')::bigint AS excluded_gross_orders,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN' AND payment_status = 'paid')::bigint AS excluded_paid_orders
    FROM current_orders
  ),
  previous_stats AS (
    SELECT
      COUNT(*)::bigint AS paid_orders,
      COALESCE(SUM(o.total), 0)::numeric AS paid_gmv
    FROM public.orders o
    WHERE p_period <> 'all'
      AND LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid'
      AND UPPER(NULLIF(BTRIM(o.currency), '')) = 'NGN'
      AND o.created_at >= p_previous_start_at
      AND o.created_at < p_previous_end_at
  ),
  merchant_users AS MATERIALIZED (
    SELECT m.id AS merchant_id, m.user_id
    FROM public.merchants m
    WHERE m.user_id IS NOT NULL
    UNION
    SELECT sm.merchant_id, sm.user_id
    FROM public.staff_members sm
    WHERE sm.user_id IS NOT NULL
      AND sm.status = 'active'
  ),
  active_stats AS (
    SELECT
      COUNT(DISTINCT mu.merchant_id) FILTER (
        WHERE a.created_at >= p_start_at AND a.created_at < p_now
      )::bigint AS current_active,
      COUNT(DISTINCT mu.merchant_id) FILTER (
        WHERE p_period <> 'all'
          AND a.created_at >= p_previous_start_at
          AND a.created_at < p_previous_end_at
      )::bigint AS previous_active
    FROM auth.audit_log_entries a
    INNER JOIN merchant_users mu
      ON mu.user_id::text = a.payload ->> 'actor_id'
    WHERE COALESCE(a.payload ->> 'action', '') IN (
      'login', 'token_refreshed', 'user_loggedin'
    )
      AND a.created_at >= LEAST(p_start_at, p_previous_start_at)
      AND a.created_at < p_now
  ),
  merchant_counts AS (
    SELECT COUNT(*)::bigint AS total_merchants FROM public.merchants
  )
  SELECT jsonb_build_object(
    'totalGmv', cs.paid_gmv,
    'grossGmv', cs.gross_gmv,
    'reportingCurrency', 'NGN',
    'excludedNonNgnOrUnknownGrossOrders', cs.excluded_gross_orders,
    'excludedNonNgnOrUnknownPaidOrders', cs.excluded_paid_orders,
    'gmvChange', CASE
      WHEN p_period = 'all' THEN 0
      WHEN ps.paid_gmv > 0 THEN ((cs.paid_gmv - ps.paid_gmv) / ps.paid_gmv) * 100
      WHEN cs.paid_gmv > 0 THEN 100 ELSE 0 END,
    'orderChange', CASE
      WHEN p_period = 'all' THEN 0
      WHEN ps.paid_orders > 0 THEN ((cs.paid_orders - ps.paid_orders)::numeric / ps.paid_orders) * 100
      WHEN cs.paid_orders > 0 THEN 100 ELSE 0 END,
    'activeMerchants', COALESCE(ast.current_active, 0),
    'activeMerchantChange', CASE
      WHEN p_period = 'all' THEN 0
      WHEN COALESCE(ast.previous_active, 0) > 0
        THEN ((COALESCE(ast.current_active, 0) - ast.previous_active)::numeric / ast.previous_active) * 100
      WHEN COALESCE(ast.current_active, 0) > 0 THEN 100 ELSE 0 END,
    'sellingMerchants', cs.selling_merchants,
    'totalMerchants', mc.total_merchants,
    'totalOrders', cs.paid_orders,
    'grossOrders', cs.gross_orders,
    'avgOrderValue', CASE WHEN cs.paid_orders > 0 THEN cs.paid_gmv / cs.paid_orders ELSE 0 END,
    'aovChange', CASE
      WHEN p_period = 'all' THEN 0
      WHEN ps.paid_orders > 0 AND ps.paid_gmv > 0 THEN
        CASE WHEN (ps.paid_gmv / ps.paid_orders) > 0
          THEN (((CASE WHEN cs.paid_orders > 0 THEN cs.paid_gmv / cs.paid_orders ELSE 0 END)
            - (ps.paid_gmv / ps.paid_orders)) / (ps.paid_gmv / ps.paid_orders)) * 100
          ELSE 0 END
      WHEN cs.paid_orders > 0 THEN 100 ELSE 0 END,
    'avgGmvPerMerchant', CASE WHEN cs.selling_merchants > 0 THEN cs.paid_gmv / cs.selling_merchants ELSE 0 END,
    'recordedPlatformFees', NULL,
    'recordedProcessorFees', NULL,
    'recordedMerchantNet', NULL
  )
  FROM current_stats cs
  CROSS JOIN previous_stats ps
  CROSS JOIN active_stats ast
  CROSS JOIN merchant_counts mc;
$$;

ALTER FUNCTION private.get_admin_platform_analytics_summary_v1(
  text, timestamptz, timestamptz, timestamptz, timestamptz
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_admin_platform_analytics_summary_v1(
  text, timestamptz, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
