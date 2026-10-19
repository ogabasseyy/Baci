-- Dashboard totals must use the same literal search semantics as notification
-- lists. Escape the escape character first, then wildcard characters, and make
-- the escape character explicit instead of relying on a session default.
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
        OR n.title ILIKE (
          '%' || replace(replace(replace(p_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        ) ESCAPE E'\\'
        OR n.message ILIKE (
          '%' || replace(replace(replace(p_search, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
        ) ESCAPE E'\\')
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

ALTER FUNCTION public.get_admin_notification_dashboard(text, text, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_admin_notification_dashboard(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_dashboard(text, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.get_admin_notification_dashboard(text, text, text, text) IS
  'Platform-admin notification dashboard totals. Search treats backslash, percent, and underscore literally.';
