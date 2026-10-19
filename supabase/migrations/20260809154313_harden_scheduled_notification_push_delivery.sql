-- Keep token access claim-bound and signal recipient clients only after the
-- parent notification is visible under the recipient RLS policy.

BEGIN;

CREATE FUNCTION public.get_claimed_notification_push_tokens_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_merchant_ids uuid[]
)
RETURNS TABLE(push_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    OR p_claim_token IS NULL
    OR p_merchant_ids IS NULL
    OR COALESCE(cardinality(p_merchant_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Invalid notification push token request' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications AS notification
    WHERE notification.id = p_notification_id
      AND notification.delivery_state = 'processing'
      AND notification.sent_at IS NULL
      AND notification.delivery_claim_token = p_claim_token
  ) THEN
    RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT DISTINCT token.token
  FROM public.push_tokens AS token
  INNER JOIN public.admin_notification_audience_snapshot AS audience
    ON audience.merchant_id = token.merchant_id
  WHERE audience.notification_id = p_notification_id
    AND audience.claim_token = p_claim_token
    AND audience.merchant_id = ANY(p_merchant_ids)
    AND token.is_active IS TRUE
    AND token.app_type = 'admin';
END;
$$;

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

    -- Recipient INSERTs occur while the parent is hidden. This durable UPDATE
    -- is emitted after the parent transition so subscribed clients refetch
    -- only once recipient RLS can reveal the notification.
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
  RETURN v_row_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])
  TO service_role;
REVOKE ALL ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scheduled_admin_notification_v1(uuid, uuid, text, text)
  TO service_role;

COMMIT;
