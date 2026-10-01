-- This migration follows the RBAC wrapper migration (20260805150800). Keep
-- policies caller-safe by using the public SECURITY DEFINER boolean wrapper,
-- never by granting application roles access to the private schema.

BEGIN;

DROP POLICY IF EXISTS notifications_delete_policy ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_policy ON public.notifications;
DROP POLICY IF EXISTS notifications_select_policy ON public.notifications;
DROP POLICY IF EXISTS notifications_update_policy ON public.notifications;

-- Keep recipient-facing policies from recursively querying each other while
-- retaining an exact parent-delivery gate for child notification rows.
CREATE OR REPLACE FUNCTION public.is_sent_admin_notification_v1(
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notifications AS n
    WHERE n.id = p_notification_id
      AND n.sent_at IS NOT NULL
      AND n.delivery_state = 'sent'
  );
$$;

REVOKE ALL ON FUNCTION public.is_sent_admin_notification_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_sent_admin_notification_v1(uuid) TO authenticated, service_role;

CREATE POLICY notifications_platform_manage ON public.notifications
  FOR ALL TO authenticated
  USING (public.current_user_has_platform_admin_permission_v1('notifications.manage'))
  WITH CHECK (public.current_user_has_platform_admin_permission_v1('notifications.manage'));

CREATE POLICY notifications_recipient_read ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.is_sent_admin_notification_v1(notifications.id)
    AND EXISTS (
      SELECT 1
      FROM public.merchant_notifications AS mn
      WHERE mn.notification_id = notifications.id
        AND public.has_merchant_access(mn.merchant_id)
    )
  );

DROP POLICY IF EXISTS merchants_read_own_notifications ON public.merchant_notifications;
DROP POLICY IF EXISTS merchants_update_own_notifications ON public.merchant_notifications;
DROP POLICY IF EXISTS system_insert_merchant_notifications ON public.merchant_notifications;
DROP POLICY IF EXISTS merchant_notifications_platform_insert ON public.merchant_notifications;

CREATE POLICY merchant_notifications_recipient_read ON public.merchant_notifications
  FOR SELECT TO authenticated
  USING (
    public.current_user_has_platform_admin_permission_v1('notifications.manage')
    OR (
      public.has_merchant_access(merchant_id)
      AND public.is_sent_admin_notification_v1(notification_id)
    )
  );

CREATE POLICY merchant_notifications_recipient_update ON public.merchant_notifications
  FOR UPDATE TO authenticated
  USING (
    public.has_merchant_access(merchant_id)
    AND public.is_sent_admin_notification_v1(notification_id)
  )
  WITH CHECK (
    public.has_merchant_access(merchant_id)
    AND public.is_sent_admin_notification_v1(notification_id)
  );

-- Recipient rows are created only through the narrowly-authorized delivery
-- RPC. Do not grant platform administrators a broad direct INSERT path.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'merchant_notifications'
    ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_notifications;
  END IF;
END;
$$;

ALTER TABLE public.merchant_notifications REPLICA IDENTITY FULL;

COMMIT;
