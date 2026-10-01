-- Final privilege and policy repairs for the truthful admin read models.
BEGIN;

REVOKE ALL ON FUNCTION public.get_admin_merchant_360(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_reconciliation(
  text, text, uuid, text, text, timestamptz, uuid, integer
) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS merchant_notifications_recipient_update
  ON public.merchant_notifications;
CREATE POLICY merchant_notifications_recipient_update
  ON public.merchant_notifications
  FOR UPDATE TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'dashboard', 'view'
    )
    AND public.is_sent_admin_notification_v1(notification_id)
  )
  WITH CHECK (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'dashboard', 'view'
    )
    AND public.is_sent_admin_notification_v1(notification_id)
  );

CREATE OR REPLACE FUNCTION public.mark_all_visible_merchant_notifications_read_v1(
  p_merchant_id uuid
)
RETURNS TABLE(updated_count bigint, remaining_unread_count bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_updated_count bigint := 0; v_remaining_unread_count bigint := 0;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'authenticated' OR (SELECT auth.uid()) IS NULL
    OR NOT public.check_staff_permission((SELECT auth.uid()), p_merchant_id, 'dashboard', 'view') THEN
    RAISE EXCEPTION 'Merchant dashboard access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.merchant_notifications AS mn SET read_at = statement_timestamp()
  FROM public.notifications AS n
  WHERE mn.notification_id = n.id AND mn.merchant_id = p_merchant_id
    AND mn.in_app_visible IS TRUE AND mn.read_at IS NULL AND mn.dismissed_at IS NULL
    AND n.sent_at IS NOT NULL AND n.delivery_state = 'sent'
    AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp());
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  SELECT COUNT(*) INTO v_remaining_unread_count
  FROM public.merchant_notifications AS mn INNER JOIN public.notifications AS n ON n.id = mn.notification_id
  WHERE mn.merchant_id = p_merchant_id AND mn.in_app_visible IS TRUE
    AND mn.read_at IS NULL AND mn.dismissed_at IS NULL AND n.sent_at IS NOT NULL
    AND n.delivery_state = 'sent' AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp());
  RETURN QUERY SELECT v_updated_count, v_remaining_unread_count;
END; $$;

CREATE OR REPLACE FUNCTION private.get_admin_platform_analytics_summary_v1(
  p_period text, p_now timestamptz, p_start_at timestamptz,
  p_previous_start_at timestamptz, p_previous_end_at timestamptz
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH current_orders AS MATERIALIZED (
    SELECT o.merchant_id, COALESCE(o.total, 0)::numeric AS total,
      LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) AS payment_status,
      UPPER(NULLIF(BTRIM(o.currency), '')) AS currency
    FROM public.orders o WHERE o.created_at >= p_start_at AND o.created_at < p_now
  ), current_stats AS (
    SELECT COUNT(*)::bigint AS gross_orders,
      COALESCE(SUM(total) FILTER (WHERE currency = 'NGN'), 0)::numeric AS gross_gmv,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::bigint AS paid_orders,
      COALESCE(SUM(total) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid'), 0)::numeric AS paid_gmv,
      COUNT(DISTINCT merchant_id) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid')::bigint AS selling_merchants,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN')::bigint AS excluded_gross_orders,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN' AND payment_status = 'paid')::bigint AS excluded_paid_orders
    FROM current_orders
  ), previous_stats AS (
    SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid')::bigint AS paid_orders,
      COALESCE(SUM(o.total) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid' AND UPPER(NULLIF(BTRIM(o.currency), '')) = 'NGN'), 0)::numeric AS paid_gmv
    FROM public.orders o WHERE p_period <> 'all' AND o.created_at >= p_previous_start_at AND o.created_at < p_previous_end_at
  ), merchant_users AS MATERIALIZED (
    SELECT m.id AS merchant_id, m.user_id FROM public.merchants m WHERE m.user_id IS NOT NULL
    UNION SELECT sm.merchant_id, sm.user_id FROM public.staff_members sm WHERE sm.user_id IS NOT NULL AND sm.status = 'active'
  ), active_stats AS (
    SELECT COUNT(DISTINCT mu.merchant_id) FILTER (WHERE a.created_at >= p_start_at AND a.created_at < p_now)::bigint AS current_active,
      COUNT(DISTINCT mu.merchant_id) FILTER (WHERE p_period <> 'all' AND a.created_at >= p_previous_start_at AND a.created_at < p_previous_end_at)::bigint AS previous_active
    FROM auth.audit_log_entries a INNER JOIN merchant_users mu ON mu.user_id::text = a.payload ->> 'actor_id'
    WHERE COALESCE(a.payload ->> 'action', '') IN ('login', 'token_refreshed', 'user_loggedin') AND a.created_at >= LEAST(p_start_at, p_previous_start_at) AND a.created_at < p_now
  ), merchant_counts AS (SELECT COUNT(*)::bigint AS total_merchants FROM public.merchants)
  SELECT jsonb_build_object(
    'totalGmv', cs.paid_gmv, 'grossGmv', cs.gross_gmv, 'reportingCurrency', 'NGN',
    'excludedNonNgnOrUnknownGrossOrders', cs.excluded_gross_orders, 'excludedNonNgnOrUnknownPaidOrders', cs.excluded_paid_orders,
    'gmvChange', CASE WHEN p_period = 'all' THEN 0 WHEN ps.paid_gmv > 0 THEN ((cs.paid_gmv - ps.paid_gmv) / ps.paid_gmv) * 100 WHEN cs.paid_gmv > 0 THEN 100 ELSE 0 END,
    'orderChange', CASE WHEN p_period = 'all' THEN 0 WHEN ps.paid_orders > 0 THEN ((cs.paid_orders - ps.paid_orders)::numeric / ps.paid_orders) * 100 WHEN cs.paid_orders > 0 THEN 100 ELSE 0 END,
    'activeMerchants', COALESCE(ast.current_active, 0), 'activeMerchantChange', CASE WHEN p_period = 'all' THEN 0 WHEN COALESCE(ast.previous_active, 0) > 0 THEN ((COALESCE(ast.current_active, 0) - ast.previous_active)::numeric / ast.previous_active) * 100 WHEN COALESCE(ast.current_active, 0) > 0 THEN 100 ELSE 0 END,
    'sellingMerchants', cs.selling_merchants, 'totalMerchants', mc.total_merchants, 'totalOrders', cs.paid_orders, 'grossOrders', cs.gross_orders,
    'avgOrderValue', CASE WHEN cs.paid_orders > 0 THEN cs.paid_gmv / cs.paid_orders ELSE 0 END,
    'aovChange', CASE WHEN p_period = 'all' THEN 0 WHEN ps.paid_orders > 0 AND ps.paid_gmv > 0 THEN CASE WHEN (ps.paid_gmv / ps.paid_orders) > 0 THEN (((CASE WHEN cs.paid_orders > 0 THEN cs.paid_gmv / cs.paid_orders ELSE 0 END) - (ps.paid_gmv / ps.paid_orders)) / (ps.paid_gmv / ps.paid_orders)) * 100 ELSE 0 END WHEN cs.paid_orders > 0 THEN 100 ELSE 0 END,
    'avgGmvPerMerchant', CASE WHEN cs.selling_merchants > 0 THEN cs.paid_gmv / cs.selling_merchants ELSE 0 END,
    'recordedPlatformFees', NULL, 'recordedProcessorFees', NULL, 'recordedMerchantNet', NULL
  ) FROM current_stats cs CROSS JOIN previous_stats ps CROSS JOIN active_stats ast CROSS JOIN merchant_counts mc;
$$;
ALTER FUNCTION private.get_admin_platform_analytics_summary_v1(text, timestamptz, timestamptz, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.get_admin_platform_analytics_summary_v1(text, timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
