-- Clear all-disabled recipient rows on retry, recover stale push reservations,
-- and keep mixed-channel quiet-hour deferrals claimable for pending push work.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_claimed_admin_notification_recipients_v1(
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
  WHERE (v_channels @> '["in_app"]'::jsonb AND COALESCE(preference.in_app_enabled, TRUE))
    OR (v_channels @> '["banner"]'::jsonb AND COALESCE(preference.banner_enabled, TRUE))
  ON CONFLICT (notification_id, merchant_id) DO UPDATE
  SET in_app_visible = EXCLUDED.in_app_visible,
    banner_visible = EXCLUDED.banner_visible;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.merchant_notifications AS existing
  SET in_app_visible = FALSE,
    banner_visible = FALSE
  FROM unnest(COALESCE(p_merchant_ids, '{}'::uuid[])) AS requested(merchant_id)
  LEFT JOIN public.notification_preferences AS preference
    ON preference.merchant_id = requested.merchant_id
  WHERE existing.notification_id = p_notification_id
    AND existing.merchant_id = requested.merchant_id
    AND NOT (
      (v_channels @> '["in_app"]'::jsonb AND COALESCE(preference.in_app_enabled, TRUE))
      OR (v_channels @> '["banner"]'::jsonb AND COALESCE(preference.banner_enabled, TRUE))
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

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

  UPDATE public.admin_notification_push_outbox AS outbox
  SET status = 'pending',
    claim_token = NULL,
    error_code = NULL,
    dispatched_at = NULL,
    updated_at = statement_timestamp()
  WHERE outbox.notification_id = p_notification_id
    AND outbox.status = 'dispatching'
    AND (
      outbox.claim_token IS DISTINCT FROM p_claim_token
      OR outbox.dispatched_at < statement_timestamp() - interval '15 minutes'
    );

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

REVOKE ALL ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[]),
  public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[]),
  public.get_claimed_notification_push_tokens_v1(uuid, uuid, uuid[])
  TO service_role;

COMMIT;
