-- Add the original service-role-only scheduled delivery state transitions.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_scheduled_admin_notifications_v1(
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  title text,
  message text,
  notification_type text,
  priority text,
  target_type text,
  target_merchant_ids uuid[],
  target_segment text,
  channels jsonb,
  action_url text,
  action_label text,
  scheduled_for timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notifications AS n
  SET delivery_state = 'expired', delivery_claimed_at = NULL
  WHERE n.sent_at IS NULL
    AND n.delivery_state IN ('pending', 'processing')
    AND n.scheduled_for IS NOT NULL
    AND n.expires_at IS NOT NULL
    AND n.expires_at <= statement_timestamp();

  RETURN QUERY
  WITH due AS (
    SELECT n.id
    FROM public.notifications AS n
    WHERE n.sent_at IS NULL
      AND n.delivery_state = 'pending'
      AND n.scheduled_for IS NOT NULL
      AND n.scheduled_for <= statement_timestamp()
      AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
    ORDER BY n.scheduled_for, n.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.notifications AS n
    SET delivery_state = 'processing',
        delivery_attempts = n.delivery_attempts + 1,
        delivery_claimed_at = statement_timestamp(),
        delivery_last_error = NULL
    FROM due
    WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT c.id, c.title, c.message, c.notification_type, c.priority,
    c.target_type, COALESCE(c.target_merchant_ids, '{}'::uuid[]), c.target_segment, c.channels,
    c.action_url, c.action_label, c.scheduled_for, c.expires_at, c.created_at
  FROM claimed AS c;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_scheduled_admin_notification_v1(
  p_notification_id uuid,
  p_outcome text,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated boolean := FALSE;
  v_row_count integer := 0;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('sent', 'retry', 'expired') THEN
    RAISE EXCEPTION 'Invalid notification finalization outcome' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.notifications
    SET sent_at = statement_timestamp(), delivery_state = 'sent',
      delivery_claimed_at = NULL, delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND sent_at IS NULL;
  ELSIF p_outcome = 'expired' THEN
    UPDATE public.notifications
    SET delivery_state = 'expired', delivery_claimed_at = NULL,
      delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND sent_at IS NULL;
  ELSE
    UPDATE public.notifications
    SET delivery_state = 'pending', delivery_claimed_at = NULL,
      delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500),
      scheduled_for = statement_timestamp() + LEAST(
        make_interval(mins => 5 * GREATEST(delivery_attempts, 1)),
        interval '60 minutes'
      )
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND sent_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_updated := v_row_count > 0;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, text, text) TO service_role;

COMMIT;
