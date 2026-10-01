-- Keep delivery_attempts as the immutable started marker while counting real
-- delivery failures separately so quiet-hour polls cannot exhaust the retry budget.
BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_failure_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_scheduled_admin_notifications_v1(p_limit integer DEFAULT 10)
RETURNS TABLE(id uuid,title text,message text,notification_type text,priority text,target_type text,target_merchant_ids uuid[],target_segment text,channels jsonb,action_url text,action_label text,scheduled_for timestamptz,expires_at timestamptz,created_at timestamptz,delivery_claim_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.admin_notification_audience_snapshot s USING public.notifications n
  WHERE n.id = s.notification_id AND n.sent_at IS NULL AND n.delivery_state = 'processing'
    AND (n.delivery_claimed_at IS NULL OR n.delivery_claimed_at < statement_timestamp() - interval '15 minutes')
    AND s.claim_token = n.delivery_claim_token;
  UPDATE public.notifications n
  SET delivery_failure_attempts = CASE
      WHEN n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed')
        THEN n.delivery_failure_attempts
      ELSE n.delivery_failure_attempts + 1
    END,
    delivery_state = CASE
      WHEN n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed') THEN 'pending'
      WHEN n.delivery_failure_attempts + 1 >= 3 THEN 'failed'
      ELSE 'pending'
    END,
    delivery_claimed_at = NULL,
    delivery_claim_token = NULL,
    delivery_failed_at = CASE
      WHEN n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed') THEN NULL
      WHEN n.delivery_failure_attempts + 1 >= 3 THEN statement_timestamp()
      ELSE NULL
    END,
    delivery_last_error = CASE
      WHEN n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed')
        THEN n.delivery_last_error
      ELSE 'scheduled delivery lease expired'
    END,
    scheduled_for = CASE
      WHEN n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed')
        THEN statement_timestamp()
      WHEN n.delivery_failure_attempts + 1 >= 3 THEN n.scheduled_for
      ELSE statement_timestamp()
    END
  WHERE n.sent_at IS NULL AND n.delivery_state = 'processing'
    AND (n.delivery_claimed_at IS NULL OR n.delivery_claimed_at < statement_timestamp() - interval '15 minutes');
  UPDATE public.notifications n SET delivery_state = 'expired', delivery_claimed_at = NULL, delivery_claim_token = NULL, delivery_last_error = NULL
  WHERE n.sent_at IS NULL AND n.delivery_state IN ('pending', 'processing') AND n.scheduled_for IS NOT NULL AND n.expires_at IS NOT NULL AND n.expires_at <= statement_timestamp();
  RETURN QUERY WITH due AS (
    SELECT n.id FROM public.notifications n WHERE n.sent_at IS NULL AND n.delivery_state = 'pending'
      AND (
        n.delivery_failure_attempts < 3
        OR n.delivery_last_error IN ('quiet_hours_deferred', 'quiet_hours_claimed')
      )
      AND n.scheduled_for IS NOT NULL AND n.scheduled_for <= statement_timestamp() AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
    ORDER BY n.scheduled_for, n.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.notifications n
    SET delivery_state = 'processing',
      delivery_attempts = GREATEST(n.delivery_attempts, 1),
      delivery_claimed_at = statement_timestamp(),
      delivery_claim_token = extensions.gen_random_uuid(),
      delivery_failed_at = NULL,
      delivery_last_error = CASE
        WHEN n.delivery_last_error = 'quiet_hours_deferred' THEN 'quiet_hours_claimed'
        ELSE NULL
      END
    FROM due WHERE n.id = due.id RETURNING n.*
  ) SELECT c.id,c.title,c.message,c.notification_type,c.priority,c.target_type,COALESCE(c.target_merchant_ids, '{}'::uuid[]),c.target_segment,c.channels,c.action_url,c.action_label,c.scheduled_for,c.expires_at,c.created_at,c.delivery_claim_token FROM claimed c;
END; $$;

CREATE OR REPLACE FUNCTION public.finalize_scheduled_admin_notification_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_error text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row_count integer := 0;
  v_terminal boolean := p_outcome IN ('sent', 'expired');
  v_quiet_resumed boolean := FALSE;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_outcome NOT IN ('sent', 'retry', 'expired', 'deferred') THEN
    RAISE EXCEPTION 'Invalid notification finalization' USING ERRCODE = '22023';
  END IF;
  IF p_outcome = 'sent' THEN
    UPDATE public.notifications
    SET sent_at = statement_timestamp(),
      delivery_state = 'sent',
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_failed_at = NULL,
      delivery_last_error = NULL
    WHERE id = p_notification_id
      AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token
      AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count > 0 THEN
      UPDATE public.merchant_notifications
      SET read_at = read_at
      WHERE notification_id = p_notification_id;
    END IF;
  ELSIF p_outcome = 'expired' THEN
    UPDATE public.notifications
    SET delivery_state = 'expired',
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_last_error = NULL
    WHERE id = p_notification_id
      AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token
      AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  ELSIF p_outcome = 'deferred' THEN
    UPDATE public.notifications
    SET delivery_state = 'pending',
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_last_error = 'quiet_hours_deferred',
      scheduled_for = statement_timestamp() + interval '15 minutes'
    WHERE id = p_notification_id
      AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token
      AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  ELSE
    SELECT n.delivery_failure_attempts + 1 >= 3, n.delivery_last_error = 'quiet_hours_claimed'
    INTO v_terminal, v_quiet_resumed
    FROM public.notifications n
    WHERE n.id = p_notification_id
      AND n.delivery_state = 'processing'
      AND n.delivery_claim_token = p_claim_token
      AND n.sent_at IS NULL
    FOR UPDATE;
    v_terminal := v_terminal AND NOT v_quiet_resumed;
    UPDATE public.notifications
    SET delivery_state = CASE WHEN delivery_failure_attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_failure_attempts = delivery_failure_attempts + 1,
      delivery_failed_at = CASE WHEN delivery_failure_attempts + 1 >= 3 THEN statement_timestamp() ELSE NULL END,
      delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500),
      scheduled_for = CASE
        WHEN delivery_failure_attempts + 1 >= 3 THEN scheduled_for
        ELSE statement_timestamp() + LEAST(make_interval(mins => 5 * GREATEST(delivery_failure_attempts + 1, 1)), interval '60 minutes')
      END
    WHERE id = p_notification_id
      AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token
      AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  END IF;
  IF v_row_count > 0 AND (v_terminal OR p_outcome = 'deferred') THEN
    DELETE FROM public.admin_notification_audience_snapshot
    WHERE notification_id = p_notification_id AND claim_token = p_claim_token;
  END IF;
  RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer),
  public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scheduled_admin_notifications_v1(integer),
  public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text)
  TO service_role;

COMMIT;
