-- Qualify RETURN QUERY columns so PL/pgSQL does not confuse the output-column
-- variables with columns from the filtered directory CTE.
CREATE OR REPLACE FUNCTION public.get_admin_merchant_health_v2(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL,
  p_health_status text DEFAULT NULL,
  p_sort_by text DEFAULT 'gmv'
)
RETURNS TABLE(
  merchant_id uuid, storefront_slug text, business_name text, email text,
  joined_at timestamptz, total_gmv numeric, total_orders bigint,
  excluded_non_ngn_or_unknown_paid_orders bigint, last_order_date date,
  active_days bigint, health_status text, total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'merchants.read'
  ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 100 OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION 'Invalid directory page' USING ERRCODE = '22023';
  END IF;
  IF p_sort_by NOT IN ('gmv', 'orders', 'joined') OR
     (p_health_status IS NOT NULL AND p_health_status NOT IN ('healthy', 'at_risk', 'churned', 'new')) THEN
    RAISE EXCEPTION 'Invalid directory filter' USING ERRCODE = '22023';
  END IF;
  IF p_search IS NOT NULL AND char_length(p_search) > 100 THEN
    RAISE EXCEPTION 'Invalid directory search' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH paid_sales AS (
    SELECT o.merchant_id,
      COALESCE(SUM(o.total) FILTER (WHERE UPPER(NULLIF(BTRIM(o.currency), '')) = 'NGN'), 0)::numeric AS total_gmv,
      COUNT(*)::bigint AS total_orders,
      COUNT(*) FILTER (WHERE UPPER(NULLIF(BTRIM(o.currency), '')) IS DISTINCT FROM 'NGN')::bigint AS excluded_orders,
      MAX(o.created_at) AS last_paid_at,
      COUNT(DISTINCT (o.created_at AT TIME ZONE 'Africa/Lagos')::date)::bigint AS active_days
    FROM public.orders AS o
    WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid'
      AND o.created_at >= (timestamp '2025-12-18 00:00:00' AT TIME ZONE 'Africa/Lagos')
    GROUP BY o.merchant_id
  ), rows AS (
    SELECT m.id AS merchant_id, m.slug AS storefront_slug, m.business_name, m.email,
      m.created_at AS joined_at, COALESCE(ps.total_gmv, 0)::numeric AS total_gmv,
      COALESCE(ps.total_orders, 0)::bigint AS total_orders,
      COALESCE(ps.excluded_orders, 0)::bigint AS excluded_non_ngn_or_unknown_paid_orders,
      (ps.last_paid_at AT TIME ZONE 'Africa/Lagos')::date AS last_order_date,
      COALESCE(ps.active_days, 0)::bigint AS active_days,
      CASE WHEN ps.last_paid_at >= statement_timestamp() - interval '30 days' THEN 'healthy'
        WHEN ps.last_paid_at >= statement_timestamp() - interval '90 days' THEN 'at_risk'
        WHEN ps.last_paid_at IS NOT NULL THEN 'churned' ELSE 'new' END AS health_status
    FROM public.merchants AS m LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
  ), filtered AS (
    SELECT rows.merchant_id, rows.storefront_slug, rows.business_name, rows.email,
      rows.joined_at, rows.total_gmv, rows.total_orders,
      rows.excluded_non_ngn_or_unknown_paid_orders, rows.last_order_date,
      rows.active_days, rows.health_status
    FROM rows WHERE (p_health_status IS NULL OR rows.health_status = p_health_status)
      AND (NULLIF(BTRIM(p_search), '') IS NULL OR rows.business_name ILIKE '%' || BTRIM(p_search) || '%'
        OR rows.email ILIKE '%' || BTRIM(p_search) || '%')
  )
  SELECT filtered.merchant_id, filtered.storefront_slug, filtered.business_name,
    filtered.email, filtered.joined_at, filtered.total_gmv, filtered.total_orders,
    filtered.excluded_non_ngn_or_unknown_paid_orders, filtered.last_order_date,
    filtered.active_days, filtered.health_status, COUNT(*) OVER ()::bigint AS total_count
  FROM filtered
  ORDER BY CASE WHEN p_sort_by = 'gmv' THEN filtered.total_gmv END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'orders' THEN filtered.total_orders END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'joined' THEN filtered.joined_at END DESC NULLS LAST,
    filtered.merchant_id ASC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

ALTER FUNCTION public.get_admin_merchant_health_v2(integer, integer, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_merchant_health_v2(integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_merchant_health_v2(integer, integer, text, text, text) TO authenticated;
COMMENT ON FUNCTION public.get_admin_merchant_health_v2(integer, integer, text, text, text) IS
  'Platform-admin, server-filtered merchant sales directory. Results are capped at 100 rows per request.';
