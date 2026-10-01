-- Repair the platform notification console with narrow, admin-only RPCs.

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_last_error text;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_state_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_state_check CHECK (
    delivery_state IN ('pending', 'processing', 'sent', 'expired')
  );

-- Existing sent rows receive the new column's default during ADD COLUMN. Repair
-- that legacy state before lifecycle RPCs start inspecting delivery_state.
UPDATE public.notifications
SET delivery_state = CASE
      WHEN sent_at IS NOT NULL THEN 'sent'
      WHEN expires_at IS NOT NULL AND expires_at <= statement_timestamp() THEN 'expired'
    END,
    delivery_claimed_at = NULL
WHERE sent_at IS NOT NULL
  OR (sent_at IS NULL AND expires_at IS NOT NULL AND expires_at <= statement_timestamp());

ALTER TABLE public.merchant_notifications
  ADD COLUMN IF NOT EXISTS in_app_visible boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS banner_visible boolean NOT NULL DEFAULT FALSE;

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
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND (
      (SELECT auth.uid()) IS NULL
      OR NOT private.has_platform_admin_permission_v1(
        (SELECT auth.uid()),
        'notifications.manage'
      )
    ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_segment NOT IN ('new', 'active', 'at_risk') THEN
    RAISE EXCEPTION 'Invalid notification segment' USING ERRCODE = '22023';
  END IF;

  WITH paid_sales AS (
    SELECT o.merchant_id,
      MAX(COALESCE(o.paid_at, o.updated_at, o.created_at)) AS last_paid_at
    FROM public.orders AS o
    WHERE o.payment_status = 'paid'
    GROUP BY o.merchant_id
  )
  SELECT COALESCE(array_agg(m.id ORDER BY m.id), '{}'::uuid[])
    INTO v_ids
  FROM public.merchants AS m
  LEFT JOIN paid_sales AS ps ON ps.merchant_id = m.id
  WHERE m.user_id IS NOT NULL
    AND m.is_platform_admin IS NOT TRUE
    AND CASE p_segment
      WHEN 'new' THEN ps.last_paid_at IS NULL
      WHEN 'active' THEN ps.last_paid_at >= statement_timestamp() - interval '30 days'
      WHEN 'at_risk' THEN ps.last_paid_at < statement_timestamp() - interval '30 days'
        AND ps.last_paid_at >= statement_timestamp() - interval '90 days'
      ELSE FALSE
    END;

  RETURN v_ids;
END;
$$;

COMMENT ON FUNCTION public.get_admin_notification_segment_merchant_ids(text) IS
  'Admin-only notification targets: new has no paid sale in all history; active was paid in 30 days; at-risk was last paid 31-90 days ago. Payment recency uses paid_at, then updated_at, then created_at for legacy paid orders.';

CREATE OR REPLACE FUNCTION public.get_admin_notification_dashboard(
  p_status text DEFAULT 'all',
  p_type text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT private.has_platform_admin_permission_v1(
      (SELECT auth.uid()),
      'notifications.manage'
    ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('all', 'sent', 'scheduled', 'draft')
    OR (p_type IS NOT NULL AND p_type NOT IN ('info', 'success', 'warning', 'error'))
    OR (p_priority IS NOT NULL AND p_priority NOT IN ('low', 'normal', 'high', 'urgent')) THEN
    RAISE EXCEPTION 'Invalid notification filter' USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT n.id, n.sent_at, n.scheduled_for, n.expires_at, n.channels
    FROM public.notifications AS n
    WHERE (p_status = 'all'
      OR (p_status = 'sent' AND n.sent_at IS NOT NULL)
      OR (p_status = 'scheduled' AND n.sent_at IS NULL AND n.scheduled_for IS NOT NULL)
      OR (p_status = 'draft' AND n.sent_at IS NULL AND n.scheduled_for IS NULL))
      AND (p_type IS NULL OR n.notification_type = p_type)
      AND (p_priority IS NULL OR n.priority = p_priority)
      AND (p_search IS NULL OR p_search = ''
        OR n.title ILIKE '%' || replace(replace(replace(p_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
        OR n.message ILIKE '%' || replace(replace(replace(p_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
  ), counts AS (
    SELECT
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::bigint AS total_sent,
      COUNT(*) FILTER (
        WHERE sent_at IS NOT NULL
          AND channels @> '["banner"]'::jsonb
          AND (expires_at IS NULL OR expires_at > statement_timestamp())
      )::bigint AS active_banners,
      COUNT(*) FILTER (
        WHERE sent_at IS NULL AND scheduled_for > statement_timestamp()
      )::bigint AS scheduled
    FROM filtered
  ), delivery AS (
    SELECT COUNT(*)::bigint AS total_delivered,
      COUNT(*) FILTER (WHERE mn.read_at IS NOT NULL)::bigint AS total_read
    FROM public.merchant_notifications AS mn
    INNER JOIN filtered AS f ON f.id = mn.notification_id
  )
  SELECT jsonb_build_object(
    'totalSent', c.total_sent,
    'activeBanners', c.active_banners,
    'scheduled', c.scheduled,
    'avgReadRate', CASE WHEN d.total_delivered > 0
      THEN ROUND((d.total_read::numeric / d.total_delivered) * 100, 2)
      ELSE 0 END
  ) INTO v_result
  FROM counts AS c CROSS JOIN delivery AS d;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_notification_segment_merchant_ids(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_segment_merchant_ids(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_admin_notification_dashboard(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_dashboard(text, text, text, text) TO authenticated;

COMMIT;
