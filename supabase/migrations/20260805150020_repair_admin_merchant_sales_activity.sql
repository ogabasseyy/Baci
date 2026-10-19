-- Rebuild the admin merchant directory from live paid orders. The legacy
-- status keys remain for URL/API compatibility, but now represent sales
-- activity rather than an unsupported claim that a merchant has churned.

BEGIN;

DROP FUNCTION IF EXISTS public.get_admin_merchant_health();

CREATE OR REPLACE FUNCTION public.get_admin_merchant_health()
RETURNS TABLE(
  merchant_id uuid,
  storefront_slug text,
  business_name text,
  email text,
  joined_at timestamp with time zone,
  total_gmv numeric,
  total_orders bigint,
  excluded_non_ngn_or_unknown_paid_orders bigint,
  last_order_date date,
  active_days bigint,
  health_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    'merchants.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH paid_sales AS (
    SELECT
      o.merchant_id,
      COALESCE(SUM(o.total) FILTER (
        WHERE UPPER(NULLIF(BTRIM(o.currency), '')) = 'NGN'
      ), 0)::numeric AS total_gmv,
      COUNT(*)::bigint AS total_orders,
      COUNT(*) FILTER (
        WHERE UPPER(NULLIF(BTRIM(o.currency), '')) IS DISTINCT FROM 'NGN'
      )::bigint AS excluded_non_ngn_or_unknown_paid_orders,
      MAX(o.created_at) AS last_paid_at,
      COUNT(DISTINCT (o.created_at AT TIME ZONE 'Africa/Lagos')::date)::bigint AS active_days
    FROM public.orders o
    WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid'
      AND o.created_at >= (
        timestamp '2025-12-18 00:00:00' AT TIME ZONE 'Africa/Lagos'
      )
    GROUP BY o.merchant_id
  )
  SELECT
    m.id AS merchant_id,
    m.slug AS storefront_slug,
    m.business_name,
    m.email,
    m.created_at AS joined_at,
    COALESCE(ps.total_gmv, 0)::numeric AS total_gmv,
    COALESCE(ps.total_orders, 0)::bigint AS total_orders,
    COALESCE(ps.excluded_non_ngn_or_unknown_paid_orders, 0)::bigint
      AS excluded_non_ngn_or_unknown_paid_orders,
    (ps.last_paid_at AT TIME ZONE 'Africa/Lagos')::date AS last_order_date,
    COALESCE(ps.active_days, 0)::bigint AS active_days,
    CASE
      WHEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
        THEN 'healthy'
      WHEN ps.last_paid_at >= statement_timestamp() - interval '90 days'
        THEN 'at_risk'
      WHEN ps.last_paid_at IS NOT NULL
        THEN 'churned'
      ELSE 'new'
    END AS health_status
  FROM public.merchants m
  LEFT JOIN paid_sales ps ON ps.merchant_id = m.id;
END;
$$;

ALTER FUNCTION public.get_admin_merchant_health() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_health()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_health()
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_merchant_health() IS
  'Admin-only live paid-sales activity. GMV is NGN-only; non-NGN or unknown-currency paid orders are counted separately. Legacy keys map to selling (healthy), sales quiet (at_risk), sales dormant (churned), and no paid sales since analytics launch (new).';

COMMIT;
