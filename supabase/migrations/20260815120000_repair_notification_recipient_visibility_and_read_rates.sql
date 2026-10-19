-- Refresh deferred recipient visibility on re-claim and scope read rates to
-- in-app-visible merchant notifications only.
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
  WHERE v_channels @> '["in_app"]'::jsonb AND COALESCE(preference.in_app_enabled, TRUE)
    OR v_channels @> '["banner"]'::jsonb AND COALESCE(preference.banner_enabled, TRUE)
  ON CONFLICT (notification_id, merchant_id) DO UPDATE
  SET in_app_visible = EXCLUDED.in_app_visible,
    banner_visible = EXCLUDED.banner_visible;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS public.get_admin_notification_stats_batch(uuid[]);
CREATE FUNCTION public.get_admin_notification_stats_batch(p_notification_ids uuid[])
RETURNS TABLE(
  notification_id uuid,
  total_sent bigint,
  total_push_sent bigint,
  total_read bigint,
  total_dismissed bigint,
  read_rate numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'notifications.manage') THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_notification_ids),0)>100 THEN
    RAISE EXCEPTION 'Too many notification IDs' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT requested.id,COUNT(DISTINCT mn.id)::bigint,
    COUNT(DISTINCT push.push_token) FILTER (WHERE push.status='accepted')::bigint,
    COUNT(DISTINCT mn.id) FILTER (WHERE mn.read_at IS NOT NULL)::bigint,
    COUNT(DISTINCT mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL)::bigint,
    CASE WHEN COUNT(DISTINCT mn.id) FILTER (WHERE mn.in_app_visible IS TRUE)>0
      THEN ROUND((COUNT(DISTINCT mn.id) FILTER (WHERE mn.read_at IS NOT NULL AND mn.in_app_visible IS TRUE))::numeric
        / COUNT(DISTINCT mn.id) FILTER (WHERE mn.in_app_visible IS TRUE) * 100, 2)
      ELSE 0 END
  FROM unnest(COALESCE(p_notification_ids,'{}'::uuid[])) requested(id)
  LEFT JOIN public.merchant_notifications mn ON mn.notification_id=requested.id
  LEFT JOIN public.admin_notification_push_outbox push ON push.notification_id=requested.id
  GROUP BY requested.id;
END; $$;

CREATE OR REPLACE FUNCTION public.get_admin_notification_detail(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; can_read boolean:=false;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'notifications.manage') THEN
    RAISE EXCEPTION 'Platform admin access required' USING ERRCODE='42501';
  END IF;
  can_read:=private.has_platform_admin_permission_v1((SELECT auth.uid()),'merchants.read');
  SELECT jsonb_build_object(
    'notification',jsonb_build_object('id',n.id,'template_id',n.template_id,'title',n.title,'message',n.message,'notification_type',n.notification_type,'priority',n.priority,'target_type',n.target_type,'target_merchant_ids',CASE WHEN can_read THEN n.target_merchant_ids ELSE '{}'::uuid[] END,'target_segment',n.target_segment,'channels',n.channels,'action_url',n.action_url,'action_label',n.action_label,'scheduled_for',n.scheduled_for,'expires_at',n.expires_at,'created_by',n.created_by,'created_at',n.created_at,'sent_at',n.sent_at,'is_system',n.is_system,'delivery_state',n.delivery_state,'delivery_attempts',n.delivery_attempts,'delivery_last_error',n.delivery_last_error),
    'stats',jsonb_build_object('total_sent',COUNT(mn.id),'total_push_sent',(SELECT COUNT(*) FROM public.admin_notification_push_outbox p WHERE p.notification_id=n.id AND p.status='accepted'),'total_read',COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL),'total_dismissed',COUNT(mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL),'read_rate',CASE WHEN COUNT(mn.id) FILTER (WHERE mn.in_app_visible IS TRUE)>0 THEN ROUND((COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL AND mn.in_app_visible IS TRUE))::numeric/COUNT(mn.id) FILTER (WHERE mn.in_app_visible IS TRUE)*100,2) ELSE 0 END),
    'deliveries',CASE WHEN can_read THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'merchant_id',d.merchant_id,'business_name',d.business_name,'created_at',d.created_at,'read_at',d.read_at,'dismissed_at',d.dismissed_at) ORDER BY d.created_at DESC,d.id DESC) FROM (SELECT mn2.id,mn2.merchant_id,COALESCE(NULLIF(BTRIM(m.business_name),''),'Unnamed Store') business_name,mn2.created_at,mn2.read_at,mn2.dismissed_at FROM public.merchant_notifications mn2 JOIN public.merchants m ON m.id=mn2.merchant_id WHERE mn2.notification_id=n.id ORDER BY mn2.created_at DESC,mn2.id DESC LIMIT 100) d),'[]'::jsonb) ELSE '[]'::jsonb END)
  INTO result FROM public.notifications n LEFT JOIN public.merchant_notifications mn ON mn.notification_id=n.id WHERE n.id=p_notification_id GROUP BY n.id;
  RETURN result;
END; $$;

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
    SELECT COUNT(*) FILTER (WHERE mn.in_app_visible IS TRUE)::bigint AS total_delivered,
      COUNT(*) FILTER (WHERE mn.read_at IS NOT NULL AND mn.in_app_visible IS TRUE)::bigint AS total_read
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

REVOKE ALL ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_claimed_admin_notification_recipients_v1(uuid, uuid, uuid[])
  TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) TO authenticated;

COMMIT;
