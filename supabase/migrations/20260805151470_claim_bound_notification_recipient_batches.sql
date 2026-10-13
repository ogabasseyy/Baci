-- Bind each durable-recipient batch to the exact active scheduled-delivery lease.

BEGIN;

CREATE FUNCTION public.create_claimed_admin_notification_recipients_v1(
  p_notification_id uuid,
  p_claim_token uuid,
  p_merchant_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_channels jsonb;
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_claim_token IS NULL OR COALESCE(cardinality(p_merchant_ids), 0) > 500 THEN
    RAISE EXCEPTION 'Invalid notification recipient batch' USING ERRCODE = '22023';
  END IF;

  SELECT n.channels INTO v_channels
  FROM public.notifications AS n
  WHERE n.id = p_notification_id AND n.sent_at IS NULL
    AND n.delivery_state = 'processing' AND n.delivery_claim_token = p_claim_token
    AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
  FOR UPDATE;
  IF v_channels IS NULL THEN
    RAISE EXCEPTION 'Notification is not available for recipient delivery' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_channels @> '["in_app"]'::jsonb OR v_channels @> '["banner"]'::jsonb) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.merchant_notifications (
    notification_id, merchant_id, in_app_visible, banner_visible
  )
  SELECT p_notification_id, requested.merchant_id,
    v_channels @> '["in_app"]'::jsonb AND COALESCE(preference.in_app_enabled, TRUE),
    v_channels @> '["banner"]'::jsonb AND COALESCE(preference.banner_enabled, TRUE)
  FROM unnest(COALESCE(p_merchant_ids, '{}'::uuid[])) AS requested(merchant_id)
  LEFT JOIN public.notification_preferences AS preference
    ON preference.merchant_id = requested.merchant_id
  WHERE v_channels @> '["in_app"]'::jsonb AND COALESCE(preference.in_app_enabled, TRUE)
    OR v_channels @> '["banner"]'::jsonb AND COALESCE(preference.banner_enabled, TRUE)
  ON CONFLICT (notification_id, merchant_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[])
  TO service_role;

COMMIT;
