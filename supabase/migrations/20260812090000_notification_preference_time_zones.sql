-- Store the merchant wall-clock zone used for notification quiet hours and
-- expose it only to the scheduled-delivery worker's narrow token RPC.
BEGIN;

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS quiet_hours_time_zone text NOT NULL DEFAULT 'Africa/Lagos';

DROP FUNCTION IF EXISTS public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]);
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
  WHERE a.notification_id = p_notification_id
    AND a.claim_token = p_claim_token
    AND a.merchant_id = ANY(p_merchant_ids)
    AND t.is_active IS TRUE
    AND t.app_type = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[])
  TO service_role;
COMMIT;
