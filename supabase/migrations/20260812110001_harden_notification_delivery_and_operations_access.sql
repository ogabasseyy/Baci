-- Keep retrying broadcasts immutable, align recipient reads with dashboard
-- permission, and retain the sanitized operations RPC as the only web entry.
BEGIN;

REVOKE ALL ON FUNCTION public.get_admin_operations_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS merchant_notifications_recipient_read
  ON public.merchant_notifications;
CREATE POLICY merchant_notifications_recipient_read
  ON public.merchant_notifications
  FOR SELECT TO authenticated
  USING (
    public.check_staff_permission(
      (SELECT auth.uid()), merchant_id, 'dashboard', 'view'
    )
    AND public.is_sent_admin_notification_v1(notification_id)
  );

CREATE OR REPLACE FUNCTION public.get_scheduled_notification_worker_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.admin_notification_worker_health%ROWTYPE; critical boolean; warning boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'operations.read') THEN
    RAISE EXCEPTION 'Operations access required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO h FROM public.admin_notification_worker_health WHERE singleton;
  SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.delivery_state='failed' AND n.delivery_failed_at>statement_timestamp()-interval '24 hours')
    OR EXISTS(SELECT 1 FROM public.admin_notification_push_outbox WHERE status='unknown' AND updated_at>statement_timestamp()-interval '24 hours')
    OR (h.last_failed_at IS NOT NULL AND h.last_failed_at>COALESCE(h.last_succeeded_at,'-infinity'::timestamptz)) INTO critical;
  SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.delivery_state='pending' AND n.scheduled_for<statement_timestamp()-interval '15 minutes')
    OR EXISTS(SELECT 1 FROM public.admin_notification_push_outbox WHERE status='dispatching') INTO warning;
  RETURN jsonb_build_object('check_name','Scheduled notification worker','status',CASE WHEN critical THEN 'critical' WHEN warning OR h.singleton IS NULL OR h.last_started_at<statement_timestamp()-interval '15 minutes' THEN 'warning' ELSE 'healthy' END,'message',CASE WHEN critical THEN 'A scheduled notification failed or has a recent unresolved push outcome.' WHEN warning THEN 'Scheduled notification delivery is overdue or needs provider review.' WHEN h.singleton IS NULL OR h.last_started_at<statement_timestamp()-interval '15 minutes' THEN 'No recent scheduled notification worker heartbeat was recorded.' ELSE 'Scheduled notification worker is active.' END,'details',jsonb_build_object('probe','worker_heartbeat_and_delivery_state'));
END; $$;

ALTER FUNCTION public.get_scheduled_notification_worker_health_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_scheduled_notification_worker_health_v1()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_scheduled_notification_worker_health_v1()
  TO authenticated;

COMMIT;
