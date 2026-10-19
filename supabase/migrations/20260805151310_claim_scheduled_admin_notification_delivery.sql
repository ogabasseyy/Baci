-- Replace scheduled-delivery claims with claim-token-bound worker RPCs.

BEGIN;

DROP FUNCTION IF EXISTS public.claim_scheduled_admin_notifications_v1(integer);
CREATE FUNCTION public.claim_scheduled_admin_notifications_v1(
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
  created_at timestamptz,
  delivery_claim_token uuid
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
  SET delivery_state = CASE WHEN n.delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END,
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_failed_at = CASE
        WHEN n.delivery_attempts >= 3 THEN statement_timestamp()
        ELSE NULL
      END,
      delivery_last_error = 'scheduled delivery lease expired',
      scheduled_for = CASE
        WHEN n.delivery_attempts >= 3 THEN n.scheduled_for
        ELSE statement_timestamp()
      END
  WHERE n.sent_at IS NULL
    AND n.delivery_state = 'processing'
    AND (
      n.delivery_claimed_at IS NULL
      OR n.delivery_claimed_at < statement_timestamp() - interval '15 minutes'
    );

  UPDATE public.notifications AS n
  SET delivery_state = 'expired',
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_last_error = NULL
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
      AND n.delivery_attempts < 3
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
        delivery_claim_token = extensions.gen_random_uuid(),
        delivery_failed_at = NULL,
        delivery_last_error = NULL
    FROM due
    WHERE n.id = due.id
    RETURNING n.*
  )
  SELECT c.id, c.title, c.message, c.notification_type, c.priority,
    c.target_type, COALESCE(c.target_merchant_ids, '{}'::uuid[]), c.target_segment, c.channels,
    c.action_url, c.action_label, c.scheduled_for, c.expires_at, c.created_at,
    c.delivery_claim_token
  FROM claimed AS c;
END;
$$;

DROP FUNCTION IF EXISTS public.finalize_scheduled_admin_notification_v1(uuid, text, text);
CREATE FUNCTION public.finalize_scheduled_admin_notification_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row_count integer := 0;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Claim token required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome NOT IN ('sent', 'retry', 'expired') THEN
    RAISE EXCEPTION 'Invalid notification finalization outcome' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.notifications
    SET sent_at = statement_timestamp(), delivery_state = 'sent',
      delivery_claimed_at = NULL, delivery_claim_token = NULL,
      delivery_failed_at = NULL, delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  ELSIF p_outcome = 'expired' THEN
    UPDATE public.notifications
    SET delivery_state = 'expired', delivery_claimed_at = NULL,
      delivery_claim_token = NULL, delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  ELSE
    UPDATE public.notifications
    SET delivery_state = CASE WHEN delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END,
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_failed_at = CASE WHEN delivery_attempts >= 3 THEN statement_timestamp() ELSE NULL END,
      delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500),
      scheduled_for = CASE
        WHEN delivery_attempts >= 3 THEN scheduled_for
        ELSE statement_timestamp() + LEAST(
          make_interval(mins => 5 * GREATEST(delivery_attempts, 1)),
          interval '60 minutes'
        )
      END
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
  END IF;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  TO service_role;

COMMENT ON COLUMN public.notifications.delivery_claim_token IS
  'Opaque lease token returned only to the worker that claimed scheduled delivery.';
COMMENT ON COLUMN public.notifications.delivery_failed_at IS
  'Timestamp of terminal scheduled-delivery retry exhaustion.';

COMMIT;
