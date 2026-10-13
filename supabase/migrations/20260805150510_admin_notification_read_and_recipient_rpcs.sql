-- Add the admin notification detail, aggregate, recipient, and banner RPCs.

BEGIN;

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
      'sent_at', n.sent_at, 'is_system', n.is_system
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

CREATE OR REPLACE FUNCTION public.get_admin_notification_stats_batch(
  p_notification_ids uuid[]
)
RETURNS TABLE(
  notification_id uuid,
  total_sent bigint,
  total_read bigint,
  total_dismissed bigint,
  read_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT private.has_platform_admin_permission_v1(
      (SELECT auth.uid()),
      'notifications.manage'
    ) THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_notification_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Too many notification IDs' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT requested.id,
    COUNT(mn.id)::bigint AS total_sent,
    COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL)::bigint AS total_read,
    COUNT(mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL)::bigint AS total_dismissed,
    CASE WHEN COUNT(mn.id) > 0
      THEN ROUND((COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL))::numeric / COUNT(mn.id) * 100, 2)
      ELSE 0 END AS read_rate
  FROM unnest(COALESCE(p_notification_ids, '{}'::uuid[])) AS requested(id)
  LEFT JOIN public.merchant_notifications AS mn ON mn.notification_id = requested.id
  GROUP BY requested.id;
END;
$$;

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
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND (
      (SELECT auth.uid()) IS NULL
      OR NOT private.has_platform_admin_permission_v1(
        (SELECT auth.uid()),
        'notifications.manage'
      )
    ) THEN
    RAISE EXCEPTION 'Platform notification permission required' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(cardinality(p_merchant_ids), 0) > 10_000 THEN
    RAISE EXCEPTION 'Too many merchant recipients' USING ERRCODE = '22023';
  END IF;

  SELECT n.channels INTO v_channels
  FROM public.notifications AS n
  WHERE n.id = p_notification_id
  FOR UPDATE;
  IF v_channels IS NULL THEN
    RAISE EXCEPTION 'Notification not found' USING ERRCODE = 'P0002';
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

CREATE OR REPLACE FUNCTION public.get_active_banners(
  p_merchant_id uuid
)
RETURNS TABLE(
  id uuid,
  notification_id uuid,
  title text,
  message text,
  notification_type text,
  priority text,
  action_url text,
  action_label text,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT mn.id, n.id, n.title, n.message, n.notification_type, n.priority,
    n.action_url, n.action_label, mn.created_at
  FROM public.merchant_notifications AS mn
  INNER JOIN public.notifications AS n ON n.id = mn.notification_id
  WHERE (
      COALESCE(auth.role(), '') = 'service_role'
      OR public.has_merchant_access(p_merchant_id)
    )
    AND mn.merchant_id = p_merchant_id
    AND mn.banner_visible IS TRUE
    AND mn.banner_dismissed_at IS NULL
    AND mn.dismissed_at IS NULL
    AND n.sent_at IS NOT NULL
    AND n.delivery_state = 'sent'
    AND (n.expires_at IS NULL OR n.expires_at > pg_catalog.now())
  ORDER BY CASE n.priority
    WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
    WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END,
    mn.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_notification_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_detail(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.create_admin_notification_recipients_v1(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_admin_notification_recipients_v1(uuid, uuid[]) TO authenticated, service_role;

COMMIT;
