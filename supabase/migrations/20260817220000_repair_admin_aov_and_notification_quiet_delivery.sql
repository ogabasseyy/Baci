-- Keep NGN monetary measures paired with NGN denominators, prune terminal
-- lease snapshots, and reschedule quiet-hour pushes without consuming retries.
BEGIN;

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
      COUNT(*) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid')::bigint AS ngn_paid_orders,
      COALESCE(SUM(total) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid'), 0)::numeric AS paid_gmv,
      COUNT(DISTINCT merchant_id) FILTER (WHERE currency = 'NGN' AND payment_status = 'paid')::bigint AS selling_merchants,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN')::bigint AS excluded_gross_orders,
      COUNT(*) FILTER (WHERE currency IS DISTINCT FROM 'NGN' AND payment_status = 'paid')::bigint AS excluded_paid_orders
    FROM current_orders
  ), previous_stats AS (
    SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid')::bigint AS paid_orders,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(NULLIF(BTRIM(o.payment_status), ''), 'unknown')) = 'paid' AND UPPER(NULLIF(BTRIM(o.currency), '')) = 'NGN')::bigint AS ngn_paid_orders,
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
    'avgOrderValue', CASE WHEN cs.ngn_paid_orders > 0 THEN cs.paid_gmv / cs.ngn_paid_orders ELSE 0 END,
    'aovChange', CASE WHEN p_period = 'all' THEN 0 WHEN ps.ngn_paid_orders > 0 AND ps.paid_gmv > 0 THEN (((CASE WHEN cs.ngn_paid_orders > 0 THEN cs.paid_gmv / cs.ngn_paid_orders ELSE 0 END) - (ps.paid_gmv / ps.ngn_paid_orders)) / (ps.paid_gmv / ps.ngn_paid_orders)) * 100 WHEN cs.ngn_paid_orders > 0 THEN 100 ELSE 0 END,
    'avgGmvPerMerchant', CASE WHEN cs.selling_merchants > 0 THEN cs.paid_gmv / cs.selling_merchants ELSE 0 END,
    'recordedPlatformFees', NULL, 'recordedProcessorFees', NULL, 'recordedMerchantNet', NULL
  ) FROM current_stats cs CROSS JOIN previous_stats ps CROSS JOIN active_stats ast CROSS JOIN merchant_counts mc;
$$;

CREATE OR REPLACE FUNCTION public.claim_scheduled_admin_notifications_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,title text,message text,notification_type text,priority text,target_type text,target_merchant_ids uuid[],target_segment text,channels jsonb,action_url text,action_label text,scheduled_for timestamptz,expires_at timestamptz,created_at timestamptz,delivery_claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.admin_notification_audience_snapshot s USING public.notifications n
  WHERE n.id = s.notification_id AND n.sent_at IS NULL AND n.delivery_state = 'processing'
    AND n.delivery_attempts >= 3 AND (n.delivery_claimed_at IS NULL OR n.delivery_claimed_at < statement_timestamp() - interval '15 minutes') AND s.claim_token = n.delivery_claim_token;
  UPDATE public.notifications n SET delivery_state = CASE WHEN n.delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END, delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_failed_at = CASE WHEN n.delivery_attempts >= 3 THEN statement_timestamp() ELSE NULL END, delivery_last_error = 'scheduled delivery lease expired', scheduled_for = CASE WHEN n.delivery_attempts >= 3 THEN n.scheduled_for ELSE statement_timestamp() END
  WHERE n.sent_at IS NULL AND n.delivery_state = 'processing' AND (n.delivery_claimed_at IS NULL OR n.delivery_claimed_at < statement_timestamp() - interval '15 minutes');
  UPDATE public.notifications n SET delivery_state = 'expired', delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_last_error = NULL
  WHERE n.sent_at IS NULL AND n.delivery_state IN ('pending', 'processing') AND n.scheduled_for IS NOT NULL AND n.expires_at IS NOT NULL AND n.expires_at <= statement_timestamp();
  RETURN QUERY WITH due AS (
    SELECT n.id FROM public.notifications n WHERE n.sent_at IS NULL AND n.delivery_state = 'pending' AND n.delivery_attempts < 3 AND n.scheduled_for IS NOT NULL AND n.scheduled_for <= statement_timestamp() AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp()) ORDER BY n.scheduled_for, n.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.notifications n SET delivery_state = 'processing', delivery_attempts = n.delivery_attempts + 1, delivery_claimed_at = statement_timestamp(), delivery_claim_token = extensions.gen_random_uuid(), delivery_failed_at = NULL, delivery_last_error = NULL FROM due WHERE n.id = due.id RETURNING n.*
  ) SELECT c.id,c.title,c.message,c.notification_type,c.priority,c.target_type,COALESCE(c.target_merchant_ids, '{}'::uuid[]),c.target_segment,c.channels,c.action_url,c.action_label,c.scheduled_for,c.expires_at,c.created_at,c.delivery_claim_token FROM claimed c;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_scheduled_admin_notification_v1(p_notification_id uuid,p_claim_token uuid,p_outcome text,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row_count integer := 0; v_terminal boolean := p_outcome IN ('sent', 'expired');
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_claim_token IS NULL OR p_outcome NOT IN ('sent', 'retry', 'expired', 'deferred') THEN RAISE EXCEPTION 'Invalid notification finalization' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'sent' THEN
    UPDATE public.notifications SET sent_at = statement_timestamp(), delivery_state = 'sent', delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_failed_at = NULL, delivery_last_error = NULL WHERE id = p_notification_id AND delivery_state = 'processing' AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  ELSIF p_outcome = 'expired' THEN
    UPDATE public.notifications SET delivery_state = 'expired', delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_last_error = NULL WHERE id = p_notification_id AND delivery_state = 'processing' AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  ELSIF p_outcome = 'deferred' THEN
    UPDATE public.notifications SET delivery_state = 'pending', delivery_attempts = GREATEST(delivery_attempts - 1, 0), delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_last_error = NULL, scheduled_for = statement_timestamp() + interval '15 minutes' WHERE id = p_notification_id AND delivery_state = 'processing' AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  ELSE
    SELECT n.delivery_attempts >= 3 INTO v_terminal FROM public.notifications n WHERE n.id = p_notification_id AND n.delivery_state = 'processing' AND n.delivery_claim_token = p_claim_token AND n.sent_at IS NULL FOR UPDATE;
    UPDATE public.notifications SET delivery_state = CASE WHEN delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END, delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_failed_at = CASE WHEN delivery_attempts >= 3 THEN statement_timestamp() ELSE NULL END, delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500), scheduled_for = CASE WHEN delivery_attempts >= 3 THEN scheduled_for ELSE statement_timestamp() + LEAST(make_interval(mins => 5 * GREATEST(delivery_attempts, 1)), interval '60 minutes') END WHERE id = p_notification_id AND delivery_state = 'processing' AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count > 0 AND (v_terminal OR p_outcome = 'deferred') THEN DELETE FROM public.admin_notification_audience_snapshot WHERE notification_id = p_notification_id AND claim_token = p_claim_token; END IF;
  RETURN v_row_count > 0;
END; $$;

REVOKE ALL ON FUNCTION private.get_admin_platform_analytics_summary_v1(text,timestamptz,timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.get_admin_platform_analytics_summary_v1(text,timestamptz,timestamptz,timestamptz,timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer),public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer),public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text) TO service_role;
COMMIT;
