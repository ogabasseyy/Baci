-- A bounded health projection makes missing cron/Vault delivery visible in the
-- existing operations health surface without exposing configuration secrets.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_notification_worker_health (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error_code text
);
ALTER TABLE public.admin_notification_worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_notification_worker_health FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_scheduled_notification_worker_health_v1(
  p_status text, p_error_code text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_status NOT IN ('started', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'Invalid worker health update' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.admin_notification_worker_health AS health (
    singleton, last_started_at, last_succeeded_at, last_failed_at, last_error_code
  ) VALUES (TRUE,
    CASE WHEN p_status = 'started' THEN statement_timestamp() END,
    CASE WHEN p_status = 'succeeded' THEN statement_timestamp() END,
    CASE WHEN p_status = 'failed' THEN statement_timestamp() END,
    CASE WHEN p_status = 'failed' THEN LEFT(COALESCE(p_error_code, 'worker_failed'), 80) END
  ) ON CONFLICT (singleton) DO UPDATE SET
    last_started_at = CASE WHEN p_status = 'started' THEN statement_timestamp() ELSE health.last_started_at END,
    last_succeeded_at = CASE WHEN p_status = 'succeeded' THEN statement_timestamp() ELSE health.last_succeeded_at END,
    last_failed_at = CASE WHEN p_status = 'failed' THEN statement_timestamp() ELSE health.last_failed_at END,
    last_error_code = CASE WHEN p_status = 'failed' THEN LEFT(COALESCE(p_error_code, 'worker_failed'), 80) ELSE health.last_error_code END;
END;
$$;

CREATE FUNCTION public.get_scheduled_notification_worker_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_health public.admin_notification_worker_health%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()), 'operations.read') THEN
    RAISE EXCEPTION 'Operations access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_health FROM public.admin_notification_worker_health WHERE singleton;
  RETURN jsonb_build_object(
    'check_name', 'Scheduled notification worker',
    'status', CASE WHEN v_health.singleton IS NULL THEN 'warning'
      WHEN v_health.last_failed_at IS NOT NULL AND v_health.last_failed_at > COALESCE(v_health.last_succeeded_at, '-infinity'::timestamptz) THEN 'critical'
      WHEN v_health.last_started_at IS NULL OR v_health.last_started_at < statement_timestamp() - interval '15 minutes' THEN 'warning'
      ELSE 'healthy' END,
    'message', CASE WHEN v_health.singleton IS NULL THEN 'No scheduled notification worker heartbeat has been recorded.'
      WHEN v_health.last_failed_at IS NOT NULL AND v_health.last_failed_at > COALESCE(v_health.last_succeeded_at, '-infinity'::timestamptz) THEN 'Scheduled notification delivery last failed.'
      WHEN v_health.last_started_at IS NULL OR v_health.last_started_at < statement_timestamp() - interval '15 minutes' THEN 'Scheduled notification worker heartbeat is stale.'
      ELSE 'Scheduled notification worker is active.' END,
    'details', jsonb_build_object('probe', 'worker_heartbeat')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_scheduled_notification_worker_health_v1(text, text),
  public.get_scheduled_notification_worker_health_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_scheduled_notification_worker_health_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scheduled_notification_worker_health_v1() TO authenticated;

COMMIT;
