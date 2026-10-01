-- Stop expired leases, prune obsolete snapshots, and retain per-token Expo
-- outcomes so accepted tickets are never retried with rejected ones.

BEGIN;

CREATE OR REPLACE FUNCTION public.renew_scheduled_notification_claim_v1(
  p_notification_id uuid, p_claim_token uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count integer;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Service role claim required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.notifications SET delivery_claimed_at = statement_timestamp()
  WHERE id = p_notification_id AND delivery_state = 'processing' AND sent_at IS NULL
    AND delivery_claim_token = p_claim_token
    AND (expires_at IS NULL OR expires_at > statement_timestamp());
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 1 THEN
    DELETE FROM public.admin_notification_audience_snapshot
    WHERE notification_id = p_notification_id AND claim_token <> p_claim_token;
    RETURN TRUE;
  END IF;
  UPDATE public.notifications SET delivery_state = 'expired', delivery_claimed_at = NULL,
    delivery_claim_token = NULL, delivery_last_error = NULL
  WHERE id = p_notification_id AND delivery_state = 'processing'
    AND delivery_claim_token = p_claim_token AND sent_at IS NULL
    AND expires_at IS NOT NULL AND expires_at <= statement_timestamp();
  DELETE FROM public.admin_notification_audience_snapshot
  WHERE notification_id = p_notification_id AND claim_token = p_claim_token;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_claimed_notification_audience_v1(
  p_notification_id uuid, p_claim_token uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_count bigint;
BEGIN
  IF NOT public.renew_scheduled_notification_claim_v1(p_notification_id, p_claim_token) THEN
    RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002';
  END IF;
  WITH notification AS (
    SELECT n.target_type, COALESCE(n.target_merchant_ids, '{}'::uuid[]) AS target_merchant_ids, n.target_segment
    FROM public.notifications AS n WHERE n.id = p_notification_id
  ), paid_sales AS (
    SELECT o.merchant_id, MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o WHERE LOWER(BTRIM(o.payment_status)) = 'paid' GROUP BY o.merchant_id
  ), inserted AS (
    INSERT INTO public.admin_notification_audience_snapshot (notification_id, claim_token, merchant_id)
    SELECT p_notification_id, p_claim_token, m.id FROM public.merchants AS m CROSS JOIN notification AS n
    LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
    WHERE m.user_id IS NOT NULL AND m.is_platform_admin IS NOT TRUE AND CASE n.target_type
      WHEN 'specific' THEN m.id = ANY(n.target_merchant_ids)
      WHEN 'all' THEN TRUE WHEN 'segment' THEN CASE n.target_segment
        WHEN 'new' THEN m.created_at >= statement_timestamp() - interval '30 days'
        WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
        WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
          AND ps.last_paid_at >= statement_timestamp() - interval '90 days' ELSE FALSE END
      ELSE FALSE END ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.record_notification_push_ticket_results_v1(
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
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

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
    OR EXISTS (SELECT 1 FROM public.admin_notification_push_outbox WHERE status IN ('dispatching', 'rejected')) INTO v_warning;
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

REVOKE ALL ON FUNCTION public.record_notification_push_ticket_results_v1(uuid, uuid, text[], text[], text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_notification_push_ticket_results_v1(uuid, uuid, text[], text[], text[], text[])
  TO service_role;

COMMIT;
