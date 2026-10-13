-- Prevent notification managers from reading recipient identities or changing
-- delivery state through PostgREST. The scheduled worker retains service role.

BEGIN;

REVOKE ALL ON TABLE public.notifications FROM anon, authenticated;

GRANT SELECT (
  id, template_id, title, message, notification_type, priority, target_type,
  target_segment, channels, action_url, action_label, scheduled_for,
  expires_at, created_by, created_at, delivery_attempts, is_system,
  delivery_state, sent_at
) ON TABLE public.notifications TO authenticated;
GRANT INSERT (
  template_id, title, message, notification_type, priority, target_type,
  target_merchant_ids, target_segment, channels, action_url, action_label,
  scheduled_for, expires_at, created_by
) ON TABLE public.notifications TO authenticated;
GRANT UPDATE (
  template_id, title, message, notification_type, priority, target_type,
  target_merchant_ids, target_segment, channels, action_url, action_label,
  scheduled_for, expires_at
) ON TABLE public.notifications TO authenticated;
GRANT DELETE ON TABLE public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_platform_manage ON public.notifications;
DROP POLICY IF EXISTS notifications_platform_read_v2 ON public.notifications;
DROP POLICY IF EXISTS notifications_platform_insert_v2 ON public.notifications;
DROP POLICY IF EXISTS notifications_platform_update_v2 ON public.notifications;
DROP POLICY IF EXISTS notifications_platform_delete_v2 ON public.notifications;

CREATE POLICY notifications_platform_read_v2 ON public.notifications
  FOR SELECT TO authenticated
  USING (public.current_user_has_platform_admin_permission_v1('notifications.manage'));

CREATE POLICY notifications_platform_insert_v2 ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND created_by = (SELECT auth.uid())
    AND sent_at IS NULL
    AND delivery_state = 'pending'
  );

CREATE POLICY notifications_platform_update_v2 ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
  ) WITH CHECK (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
  );

CREATE POLICY notifications_platform_delete_v2 ON public.notifications
  FOR DELETE TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    AND sent_at IS NULL
    AND delivery_state = 'pending'
  );

COMMENT ON TABLE public.notifications IS
  'Notification lifecycle fields are worker-only; managers receive no target merchant identifiers in PostgREST projections.';

COMMIT;
