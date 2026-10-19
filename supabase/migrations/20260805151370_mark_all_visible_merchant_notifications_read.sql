-- Atomically mark the caller's complete visible notification set as read.
-- This avoids PostgREST's default response-row cap when a merchant has >1000 rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.mark_all_visible_merchant_notifications_read_v1(
  p_merchant_id uuid
)
RETURNS TABLE(
  updated_count bigint,
  remaining_unread_count bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_count bigint := 0;
  v_remaining_unread_count bigint := 0;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'authenticated'
    OR (SELECT auth.uid()) IS NULL
    OR NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'Merchant access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.merchant_notifications AS mn
  SET read_at = statement_timestamp()
  FROM public.notifications AS n
  WHERE mn.notification_id = n.id
    AND mn.merchant_id = p_merchant_id
    AND mn.in_app_visible IS TRUE
    AND mn.read_at IS NULL
    AND mn.dismissed_at IS NULL
    AND n.sent_at IS NOT NULL
    AND n.delivery_state = 'sent'
    AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp());
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  SELECT COUNT(*)
    INTO v_remaining_unread_count
  FROM public.merchant_notifications AS mn
  INNER JOIN public.notifications AS n ON n.id = mn.notification_id
  WHERE mn.merchant_id = p_merchant_id
    AND mn.in_app_visible IS TRUE
    AND mn.read_at IS NULL
    AND mn.dismissed_at IS NULL
    AND n.sent_at IS NOT NULL
    AND n.delivery_state = 'sent'
    AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp());

  RETURN QUERY SELECT v_updated_count, v_remaining_unread_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_visible_merchant_notifications_read_v1(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_visible_merchant_notifications_read_v1(uuid)
  TO authenticated;

COMMIT;
