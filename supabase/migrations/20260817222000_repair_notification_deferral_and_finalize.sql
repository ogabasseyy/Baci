-- Ignore terminal push outbox rows when selecting quiet-hour candidates, and
-- preserve the parent sent transition when no in-app recipient rows exist.
BEGIN;

DROP FUNCTION IF EXISTS public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[]);
CREATE FUNCTION public.get_claimed_notification_push_tokens_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_merchant_ids uuid[]
)
RETURNS TABLE(
  push_token text,
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_time_zone text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    OR p_claim_token IS NULL
    OR p_merchant_ids IS NULL
    OR COALESCE(cardinality(p_merchant_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Invalid notification push token request' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.id = p_notification_id
      AND n.delivery_state = 'processing'
      AND n.sent_at IS NULL
      AND n.delivery_claim_token = p_claim_token
  ) THEN
    RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT DISTINCT t.token, p.quiet_hours_start, p.quiet_hours_end,
    COALESCE(NULLIF(btrim(p.quiet_hours_time_zone), ''), 'Africa/Lagos')
  FROM public.push_tokens t
  JOIN public.admin_notification_audience_snapshot a ON a.merchant_id = t.merchant_id
  LEFT JOIN public.notification_preferences p ON p.merchant_id = t.merchant_id
  LEFT JOIN public.admin_notification_push_outbox o
    ON o.notification_id = p_notification_id AND o.push_token = t.token
  WHERE a.notification_id = p_notification_id
    AND a.claim_token = p_claim_token
    AND a.merchant_id = ANY(p_merchant_ids)
    AND t.is_active IS TRUE
    AND t.app_type = 'admin'
    AND (o.push_token IS NULL OR o.status = 'pending');
END;
$$;

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
    SELECT n.delivery_attempts >= 3, n.delivery_last_error = 'quiet_hours_claimed'
    INTO v_terminal, v_quiet_resumed
    FROM public.notifications n
    WHERE n.id = p_notification_id
      AND n.delivery_state = 'processing'
      AND n.delivery_claim_token = p_claim_token
      AND n.sent_at IS NULL
    FOR UPDATE;
    v_terminal := v_terminal AND NOT v_quiet_resumed;
    UPDATE public.notifications
    SET delivery_state = CASE WHEN delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END,
      delivery_claimed_at = NULL,
      delivery_claim_token = NULL,
      delivery_failed_at = CASE WHEN delivery_attempts >= 3 THEN statement_timestamp() ELSE NULL END,
      delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500),
      scheduled_for = CASE
        WHEN delivery_attempts >= 3 THEN scheduled_for
        ELSE statement_timestamp() + LEAST(make_interval(mins => 5 * GREATEST(delivery_attempts, 1)), interval '60 minutes')
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

REVOKE ALL ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]),
  public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]),
  public.finalize_scheduled_admin_notification_v1(uuid,uuid,text,text)
  TO service_role;

COMMIT;
