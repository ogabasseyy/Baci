-- Audience snapshots are claim-scoped delivery state. Retain them while a
-- claim can retry, but remove them once finalization reaches a terminal state.

BEGIN;

CREATE OR REPLACE FUNCTION public.finalize_scheduled_admin_notification_v1(
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
  v_terminal boolean := p_outcome IN ('sent', 'expired');
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR p_outcome NOT IN ('sent', 'retry', 'expired') THEN
    RAISE EXCEPTION 'Invalid notification finalization' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'sent' THEN
    UPDATE public.notifications
    SET sent_at = statement_timestamp(), delivery_state = 'sent',
      delivery_claimed_at = NULL, delivery_claim_token = NULL,
      delivery_failed_at = NULL, delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count > 0 THEN
      UPDATE public.merchant_notifications
      SET read_at = read_at
      WHERE notification_id = p_notification_id;
    END IF;
  ELSIF p_outcome = 'expired' THEN
    UPDATE public.notifications
    SET delivery_state = 'expired', delivery_claimed_at = NULL,
      delivery_claim_token = NULL, delivery_last_error = NULL
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  ELSE
    SELECT n.delivery_attempts >= 3
    INTO v_terminal
    FROM public.notifications AS n
    WHERE n.id = p_notification_id AND n.delivery_state = 'processing'
      AND n.delivery_claim_token = p_claim_token AND n.sent_at IS NULL
    FOR UPDATE;

    UPDATE public.notifications
    SET delivery_state = CASE WHEN delivery_attempts >= 3 THEN 'failed' ELSE 'pending' END,
      delivery_claimed_at = NULL, delivery_claim_token = NULL,
      delivery_failed_at = CASE WHEN delivery_attempts >= 3 THEN statement_timestamp() ELSE NULL END,
      delivery_last_error = LEFT(COALESCE(p_error, 'scheduled delivery failed'), 500),
      scheduled_for = CASE WHEN delivery_attempts >= 3 THEN scheduled_for
        ELSE statement_timestamp() + LEAST(make_interval(mins => 5 * GREATEST(delivery_attempts, 1)), interval '60 minutes') END
    WHERE id = p_notification_id AND delivery_state = 'processing'
      AND delivery_claim_token = p_claim_token AND sent_at IS NULL;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  END IF;

  IF v_row_count > 0 AND v_terminal THEN
    DELETE FROM public.admin_notification_audience_snapshot
    WHERE notification_id = p_notification_id AND claim_token = p_claim_token;
  END IF;
  RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text) IS
  'Finalizes a claimed scheduled notification, signals visible recipients after sent, and prunes terminal claim snapshots.';

COMMIT;
