-- Restrict recipient creation to the scheduled worker's active delivery lease
-- and prevent expired parents from being exposed through recipient RLS.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_admin_notification_recipients_v1(
  p_notification_id uuid,
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

  IF COALESCE(cardinality(p_merchant_ids), 0) > 10_000 THEN
    RAISE EXCEPTION 'Too many merchant recipients' USING ERRCODE = '22023';
  END IF;

  -- A row lock binds this recipient batch to the worker's processing state.
  -- The scheduler/finalizer cannot advance it while recipients are inserted.
  SELECT n.channels INTO v_channels
  FROM public.notifications AS n
  WHERE n.id = p_notification_id
    AND n.sent_at IS NULL
    AND n.delivery_state = 'processing'
    AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
  FOR UPDATE;
  IF v_channels IS NULL THEN
    RAISE EXCEPTION 'Notification is not available for recipient delivery'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_channels @> '["in_app"]'::jsonb
    OR v_channels @> '["banner"]'::jsonb
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.merchant_notifications (
    notification_id, merchant_id, in_app_visible, banner_visible
  )
  SELECT p_notification_id, requested.merchant_id,
    visible.in_app_visible, visible.banner_visible
  FROM unnest(COALESCE(p_merchant_ids, '{}'::uuid[])) AS requested(merchant_id)
  LEFT JOIN public.notification_preferences AS preference
    ON preference.merchant_id = requested.merchant_id
  CROSS JOIN LATERAL (
    SELECT (
      v_channels @> '["in_app"]'::jsonb
      AND COALESCE(preference.in_app_enabled, TRUE)
    ) AS in_app_visible, (
      v_channels @> '["banner"]'::jsonb
      AND COALESCE(preference.banner_enabled, TRUE)
    ) AS banner_visible
  ) AS visible
  WHERE visible.in_app_visible OR visible.banner_visible
  ON CONFLICT (notification_id, merchant_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_sent_admin_notification_v1(
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notifications AS n
    WHERE n.id = p_notification_id
      AND n.sent_at IS NOT NULL
      AND n.delivery_state = 'sent'
      AND (n.expires_at IS NULL OR n.expires_at > statement_timestamp())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_notification_segment_merchant_ids(
  p_segment text
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_segment NOT IN ('new', 'active', 'at_risk') THEN
    RAISE EXCEPTION 'Invalid notification segment' USING ERRCODE = '22023';
  END IF;

  WITH paid_sales AS (
    SELECT o.merchant_id,
      MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o
    WHERE LOWER(BTRIM(o.payment_status)) = 'paid'
    GROUP BY o.merchant_id
  )
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::uuid[])
    INTO v_ids
  FROM public.merchants AS m
  LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
  WHERE m.user_id IS NOT NULL
    AND m.is_platform_admin IS NOT TRUE
    AND CASE p_segment
      WHEN 'new' THEN m.created_at >= statement_timestamp() - interval '30 days'
      WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
      WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
        AND ps.last_paid_at >= statement_timestamp() - interval '90 days'
      ELSE FALSE
    END;

  RETURN v_ids;
END;
$$;

COMMENT ON FUNCTION public.get_admin_notification_segment_merchant_ids(text) IS
  'Worker-only notification targets: new merchants were created in the last 30 days; active merchants have a normalized paid sale in the last 30 days; at-risk merchants last had a normalized paid sale 31-90 days ago. Payment recency uses paid_at, then updated_at, then created_at for legacy paid orders.';

REVOKE ALL ON FUNCTION public.create_admin_notification_recipients_v1(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_admin_notification_recipients_v1(uuid, uuid[])
  TO service_role;

REVOKE ALL ON FUNCTION public.get_admin_notification_segment_merchant_ids(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_segment_merchant_ids(text)
  TO service_role;

-- The recipient RLS UPDATE predicate governs rows, not columns. Remove the
-- inherited broad table grant so a merchant cannot retarget a recipient row to
-- a different sent parent, then grant only the three UI state transitions.
REVOKE ALL ON TABLE public.merchant_notifications FROM anon;
REVOKE INSERT, DELETE, UPDATE ON TABLE public.merchant_notifications FROM authenticated;
GRANT SELECT ON TABLE public.merchant_notifications TO authenticated;
GRANT UPDATE (read_at, dismissed_at, banner_dismissed_at)
  ON TABLE public.merchant_notifications TO authenticated;

-- Recipient rows expose merchant identities. Notification-management access
-- alone is insufficient; admin detail/list projections use definer RPCs that
-- redact identities unless the caller also has merchants.read.
DROP POLICY IF EXISTS merchant_notifications_recipient_read
  ON public.merchant_notifications;
CREATE POLICY merchant_notifications_recipient_read
  ON public.merchant_notifications
  FOR SELECT TO authenticated
  USING (
    public.has_merchant_access(merchant_id)
    AND public.is_sent_admin_notification_v1(notification_id)
  );

COMMIT;
