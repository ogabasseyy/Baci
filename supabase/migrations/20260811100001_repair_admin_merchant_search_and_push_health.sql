-- Keep admin search literal and avoid treating expected terminal push token
-- rejections as an ongoing worker incident.

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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
      AND (NULLIF(BTRIM(p_search), '') IS NULL OR
        rows.business_name ILIKE ('%' || replace(replace(replace(BTRIM(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%') ESCAPE E'\\'
        OR rows.email ILIKE ('%' || replace(replace(replace(BTRIM(p_search), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%') ESCAPE E'\\')
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

COMMENT ON FUNCTION public.get_admin_merchant_health_v2(integer, integer, text, text, text) IS
  'Platform-admin merchant directory with literal search semantics.';

-- Bridge scheduled-admin Expo tickets into the existing receipt poller's
-- canonical queue. Accepted tickets are only provider acknowledgements; the
-- receipt worker must still observe the eventual delivery outcome.
CREATE OR REPLACE FUNCTION public.record_notification_push_ticket_results_v1(
  p_notification_id uuid, p_claim_token uuid, p_tokens text[], p_statuses text[],
  p_ticket_ids text[], p_error_codes text[]
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL
    OR cardinality(p_tokens) IS DISTINCT FROM cardinality(p_statuses)
    OR cardinality(p_tokens) IS DISTINCT FROM cardinality(p_ticket_ids)
    OR cardinality(p_tokens) IS DISTINCT FROM cardinality(p_error_codes)
    OR EXISTS (SELECT 1 FROM unnest(p_statuses) AS item(status) WHERE status NOT IN ('accepted', 'rejected')) THEN
    RAISE EXCEPTION 'Invalid notification push ticket results' USING ERRCODE = '22023';
  END IF;
  UPDATE public.admin_notification_push_outbox AS outbox
  SET status = item.status, provider_ticket_id = CASE WHEN item.status = 'accepted' THEN item.ticket_id ELSE NULL END,
    accepted_at = CASE WHEN item.status = 'accepted' THEN statement_timestamp() ELSE NULL END,
    error_code = CASE WHEN item.status = 'rejected' THEN LEFT(COALESCE(item.error_code, 'provider_rejected'), 80) ELSE NULL END,
    updated_at = statement_timestamp()
  FROM unnest(p_tokens, p_statuses, p_ticket_ids, p_error_codes) AS item(push_token, status, ticket_id, error_code)
  WHERE outbox.notification_id = p_notification_id AND outbox.push_token = item.push_token
    AND outbox.status = 'dispatching' AND outbox.claim_token = p_claim_token;
  INSERT INTO public.push_notification_tickets
    (ticket_id, push_token, app_type, notification_type, status)
  SELECT item.ticket_id, item.push_token, 'admin', 'admin_broadcast', 'pending'
  FROM unnest(p_tokens, p_statuses, p_ticket_ids) AS item(push_token, status, ticket_id)
  WHERE item.status = 'accepted' AND NULLIF(item.ticket_id, '') IS NOT NULL
  ON CONFLICT (ticket_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_notification_push_ticket_results_v1(uuid, uuid, text[], text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_push_ticket_results_v1(uuid, uuid, text[], text[], text[], text[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_scheduled_notification_worker_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_health public.admin_notification_worker_health%ROWTYPE; v_critical boolean; v_warning boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()), 'operations.read') THEN
    RAISE EXCEPTION 'Operations access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_health FROM public.admin_notification_worker_health WHERE singleton;
  SELECT EXISTS (SELECT 1 FROM public.notifications AS n WHERE n.delivery_state = 'failed')
    OR EXISTS (SELECT 1 FROM public.admin_notification_push_outbox WHERE status = 'unknown')
    OR (v_health.last_failed_at IS NOT NULL AND v_health.last_failed_at > COALESCE(v_health.last_succeeded_at, '-infinity'::timestamptz)) INTO v_critical;
  SELECT EXISTS (SELECT 1 FROM public.notifications AS n WHERE n.delivery_state = 'pending'
    AND n.scheduled_for < statement_timestamp() - interval '15 minutes')
    OR EXISTS (SELECT 1 FROM public.admin_notification_push_outbox WHERE status = 'dispatching') INTO v_warning;
  RETURN jsonb_build_object('check_name', 'Scheduled notification worker', 'status', CASE
    WHEN v_critical THEN 'critical' WHEN v_warning OR v_health.singleton IS NULL
      OR v_health.last_started_at < statement_timestamp() - interval '15 minutes' THEN 'warning' ELSE 'healthy' END,
    'message', CASE WHEN v_critical THEN 'A scheduled notification failed or has an unknown push outcome.'
      WHEN v_warning THEN 'Scheduled notification delivery is overdue or needs provider review.'
      WHEN v_health.singleton IS NULL OR v_health.last_started_at < statement_timestamp() - interval '15 minutes' THEN 'No recent scheduled notification worker heartbeat was recorded.'
      ELSE 'Scheduled notification worker is active.' END,
    'details', jsonb_build_object('probe', 'worker_heartbeat_and_delivery_state'));
END;
$$;

COMMENT ON FUNCTION public.get_scheduled_notification_worker_health_v1() IS
  'Worker health excludes terminal push rejections from ongoing warnings.';
