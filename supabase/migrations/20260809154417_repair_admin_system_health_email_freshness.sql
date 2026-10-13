-- Preserve the bounded health model, but do not keep the platform degraded for
-- an immutable email-attempt failure whose delivery window has long elapsed.
ALTER FUNCTION public.get_admin_system_health_v1() RENAME TO get_admin_system_health_v0;

CREATE OR REPLACE FUNCTION public.get_admin_system_health_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_notification_failure boolean;
  v_result jsonb;
  v_health jsonb;
BEGIN
  IF NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'operations.read'
  ) THEN
    RAISE EXCEPTION 'platform_permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.email_send_attempts AS email_attempt
    WHERE (email_attempt.status = 'failed'
        AND email_attempt.created_at >= v_now - interval '24 hours')
      OR (email_attempt.status = 'pending'
        AND email_attempt.updated_at < v_now - interval '15 minutes')
  ) OR EXISTS (
    SELECT 1 FROM public.push_notification_attempts AS push_attempt
    WHERE push_attempt.status IN ('failed', 'partial_failure')
  ) OR EXISTS (
    SELECT 1 FROM public.order_notification_outbox AS order_outbox
    WHERE order_outbox.status = 'failed'
      OR (order_outbox.status = 'processing'
        AND (order_outbox.locked_at IS NULL
          OR order_outbox.locked_at < v_now - interval '15 minutes'))
  ) OR EXISTS (
    SELECT 1 FROM public.shipment_tracking_notification_outbox AS tracking_outbox
    WHERE tracking_outbox.status = 'failed'
      OR (tracking_outbox.status = 'processing'
        AND (tracking_outbox.locked_at IS NULL
          OR tracking_outbox.locked_at < v_now - interval '15 minutes'))
  ) INTO v_notification_failure;

  v_result := public.get_admin_system_health_v0();
  SELECT COALESCE(jsonb_agg(
    CASE WHEN health_check.value ->> 'check_name' = 'Notification delivery' THEN
      jsonb_build_object(
        'check_name', 'Notification delivery',
        'status', CASE WHEN v_notification_failure THEN 'warning' ELSE 'healthy' END,
        'message', CASE WHEN v_notification_failure
          THEN 'A recent failed or stale pending email, push, order, or shipment-tracking notification needs attention.'
          ELSE 'No recent failed emails or stale pending emails, or failed or stale notification outbox rows were found.' END,
        'details', COALESCE(health_check.value -> 'details', '{}'::jsonb)
          || jsonb_build_object('emailFailureWindow', '24 hours')
      )
    ELSE health_check.value END
    ORDER BY health_check.ordinality
  ), '[]'::jsonb)
  INTO v_health
  FROM jsonb_array_elements(COALESCE(v_result -> 'health', '[]'::jsonb))
    WITH ORDINALITY AS health_check(value, ordinality);

  RETURN jsonb_set(v_result, '{health}', v_health);
END;
$$;

ALTER FUNCTION public.get_admin_system_health_v0() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_system_health_v0()
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.get_admin_system_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_system_health_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_system_health_v1() TO authenticated;

COMMENT ON FUNCTION public.get_admin_system_health_v1() IS
  'Returns bounded live database and operations health to callers with operations.read. Failed emails age out after 24 hours; unresolved pending emails are actionable after 15 minutes.';
