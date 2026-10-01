-- Harden scheduled-admin-notification lifecycle state and admin projections.

BEGIN;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_claim_token uuid,
  ADD COLUMN IF NOT EXISTS delivery_failed_at timestamptz;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_state_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_state_check CHECK (
    delivery_state IN ('pending', 'processing', 'sent', 'expired', 'failed')
  );

CREATE OR REPLACE FUNCTION public.get_admin_notification_detail(
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_can_read_merchants boolean := FALSE;
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT private.has_platform_admin_permission_v1(
      (SELECT auth.uid()),
      'notifications.manage'
    ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  v_can_read_merchants := private.has_platform_admin_permission_v1(
    (SELECT auth.uid()),
    'merchants.read'
  );

  SELECT jsonb_build_object(
    'notification', jsonb_build_object(
      'id', n.id, 'template_id', n.template_id, 'title', n.title,
      'message', n.message, 'notification_type', n.notification_type,
      'priority', n.priority, 'target_type', n.target_type,
      'target_merchant_ids', CASE WHEN v_can_read_merchants
        THEN n.target_merchant_ids ELSE '{}'::uuid[] END,
      'target_segment', n.target_segment, 'channels', n.channels,
      'action_url', n.action_url, 'action_label', n.action_label,
      'scheduled_for', n.scheduled_for, 'expires_at', n.expires_at,
      'created_by', n.created_by, 'created_at', n.created_at,
      'sent_at', n.sent_at, 'is_system', n.is_system,
      'delivery_state', n.delivery_state,
      'delivery_attempts', n.delivery_attempts,
      'delivery_claimed_at', n.delivery_claimed_at,
      'delivery_failed_at', n.delivery_failed_at,
      'delivery_last_error', CASE WHEN n.delivery_last_error IS NULL THEN NULL
        ELSE LEFT(regexp_replace(n.delivery_last_error, '[[:cntrl:]]', ' ', 'g'), 500) END
    ),
    'stats', jsonb_build_object(
      'total_sent', COUNT(mn.id),
      'total_read', COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL),
      'total_dismissed', COUNT(mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL),
      'read_rate', CASE WHEN COUNT(mn.id) > 0
        THEN ROUND((COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL))::numeric / COUNT(mn.id) * 100, 2)
        ELSE 0 END
    ),
    'deliveries', CASE WHEN v_can_read_merchants THEN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', delivery.id, 'merchant_id', delivery.merchant_id,
          'business_name', delivery.business_name, 'created_at', delivery.created_at,
          'read_at', delivery.read_at, 'dismissed_at', delivery.dismissed_at
        ) ORDER BY delivery.created_at DESC, delivery.id DESC)
        FROM (
          SELECT mn2.id, mn2.merchant_id,
            COALESCE(NULLIF(BTRIM(m.business_name), ''), 'Unnamed Store') AS business_name,
            mn2.created_at, mn2.read_at, mn2.dismissed_at
          FROM public.merchant_notifications AS mn2
          INNER JOIN public.merchants AS m ON m.id = mn2.merchant_id
          WHERE mn2.notification_id = n.id
          ORDER BY mn2.created_at DESC, mn2.id DESC
          LIMIT 100
        ) AS delivery
      ), '[]'::jsonb)
      ELSE '[]'::jsonb END
  ) INTO v_result
  FROM public.notifications AS n
  LEFT JOIN public.merchant_notifications AS mn ON mn.notification_id = n.id
  WHERE n.id = p_notification_id
  GROUP BY n.id;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_notification_dashboard(
  p_status text DEFAULT 'all', p_type text DEFAULT NULL,
  p_priority text DEFAULT NULL, p_search text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1(
    (SELECT auth.uid()), 'notifications.manage'
  ) THEN RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN (
    'all', 'sent', 'scheduled', 'queued', 'processing', 'failed', 'expired'
  )
    OR (p_type IS NOT NULL AND p_type NOT IN ('info', 'success', 'warning', 'error'))
    OR (p_priority IS NOT NULL AND p_priority NOT IN ('low', 'normal', 'high', 'urgent')) THEN
    RAISE EXCEPTION 'Invalid notification filter' USING ERRCODE = '22023';
  END IF;
  WITH filtered AS (
    SELECT n.id, n.sent_at, n.scheduled_for, n.expires_at, n.channels, n.delivery_state
    FROM public.notifications AS n
    WHERE (p_status = 'all' OR (p_status = 'sent' AND n.sent_at IS NOT NULL)
      OR (p_status = 'scheduled' AND n.sent_at IS NULL
        AND n.delivery_state = 'pending'
        AND n.scheduled_for > statement_timestamp())
      OR (p_status = 'queued' AND n.sent_at IS NULL
        AND n.delivery_state = 'pending'
        AND n.scheduled_for <= statement_timestamp())
      OR (p_status = 'processing' AND n.delivery_state = 'processing')
      OR (p_status = 'failed' AND n.delivery_state = 'failed')
      OR (p_status = 'expired' AND n.delivery_state = 'expired'))
      AND (p_type IS NULL OR n.notification_type = p_type)
      AND (p_priority IS NULL OR n.priority = p_priority)
      AND (p_search IS NULL OR p_search = ''
        OR n.title ILIKE '%' || replace(replace(replace(p_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
        OR n.message ILIKE '%' || replace(replace(replace(p_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
  ), counts AS (
    SELECT COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::bigint AS total_sent,
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL AND channels @> '["banner"]'::jsonb
        AND (expires_at IS NULL OR expires_at > statement_timestamp()))::bigint AS active_banners,
      COUNT(*) FILTER (WHERE sent_at IS NULL AND scheduled_for > statement_timestamp())::bigint AS scheduled,
      COUNT(*) FILTER (WHERE delivery_state = 'pending')::bigint AS delivery_pending,
      COUNT(*) FILTER (WHERE delivery_state = 'processing')::bigint AS delivery_processing,
      COUNT(*) FILTER (WHERE delivery_state = 'failed')::bigint AS delivery_failed,
      COUNT(*) FILTER (WHERE delivery_state = 'expired')::bigint AS delivery_expired
    FROM filtered
  ), delivery AS (
    SELECT COUNT(*)::bigint AS total_delivered,
      COUNT(*) FILTER (WHERE mn.read_at IS NOT NULL)::bigint AS total_read
    FROM public.merchant_notifications AS mn INNER JOIN filtered AS f ON f.id = mn.notification_id
  ) SELECT jsonb_build_object(
    'totalSent', c.total_sent, 'activeBanners', c.active_banners, 'scheduled', c.scheduled,
    'deliveryPending', c.delivery_pending, 'deliveryProcessing', c.delivery_processing,
    'deliveryFailed', c.delivery_failed, 'deliveryExpired', c.delivery_expired,
    'avgReadRate', CASE WHEN d.total_delivered > 0
      THEN ROUND((d.total_read::numeric / d.total_delivered) * 100, 2) ELSE 0 END
  ) INTO v_result FROM counts AS c CROSS JOIN delivery AS d;
  RETURN v_result;
END;
$$;

COMMIT;
