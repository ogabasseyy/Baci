-- Separate push outcomes from in-app recipient rows, expire old terminal
-- failures from health, and defer pushes during merchant quiet hours.
BEGIN;

DROP FUNCTION IF EXISTS public.get_admin_notification_stats_batch(uuid[]);
CREATE FUNCTION public.get_admin_notification_stats_batch(p_notification_ids uuid[])
RETURNS TABLE(notification_id uuid,total_sent bigint,total_push_sent bigint,total_read bigint,total_dismissed bigint,read_rate numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'notifications.manage') THEN RAISE EXCEPTION 'Platform admin access required' USING ERRCODE='42501'; END IF;
  IF COALESCE(cardinality(p_notification_ids),0)>100 THEN RAISE EXCEPTION 'Too many notification IDs' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT requested.id,COUNT(DISTINCT mn.id)::bigint,
    COUNT(DISTINCT push.push_token) FILTER (WHERE push.status='accepted')::bigint,
    COUNT(DISTINCT mn.id) FILTER (WHERE mn.read_at IS NOT NULL)::bigint,
    COUNT(DISTINCT mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL)::bigint,
    CASE WHEN COUNT(DISTINCT mn.id)>0 THEN ROUND((COUNT(DISTINCT mn.id) FILTER (WHERE mn.read_at IS NOT NULL))::numeric/COUNT(DISTINCT mn.id)*100,2) ELSE 0 END
  FROM unnest(COALESCE(p_notification_ids,'{}'::uuid[])) requested(id)
  LEFT JOIN public.merchant_notifications mn ON mn.notification_id=requested.id
  LEFT JOIN public.admin_notification_push_outbox push ON push.notification_id=requested.id
  GROUP BY requested.id;
END; $$;
REVOKE ALL ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_admin_notification_stats_batch(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_notification_detail(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; can_read boolean:=false;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'notifications.manage') THEN RAISE EXCEPTION 'Platform admin access required' USING ERRCODE='42501'; END IF;
  can_read:=private.has_platform_admin_permission_v1((SELECT auth.uid()),'merchants.read');
  SELECT jsonb_build_object(
    'notification',jsonb_build_object('id',n.id,'template_id',n.template_id,'title',n.title,'message',n.message,'notification_type',n.notification_type,'priority',n.priority,'target_type',n.target_type,'target_merchant_ids',CASE WHEN can_read THEN n.target_merchant_ids ELSE '{}'::uuid[] END,'target_segment',n.target_segment,'channels',n.channels,'action_url',n.action_url,'action_label',n.action_label,'scheduled_for',n.scheduled_for,'expires_at',n.expires_at,'created_by',n.created_by,'created_at',n.created_at,'sent_at',n.sent_at,'is_system',n.is_system),
    'stats',jsonb_build_object('total_sent',COUNT(mn.id),'total_push_sent',(SELECT COUNT(*) FROM public.admin_notification_push_outbox p WHERE p.notification_id=n.id AND p.status='accepted'),'total_read',COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL),'total_dismissed',COUNT(mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL),'read_rate',CASE WHEN COUNT(mn.id)>0 THEN ROUND((COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL))::numeric/COUNT(mn.id)*100,2) ELSE 0 END),
    'deliveries',CASE WHEN can_read THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'merchant_id',d.merchant_id,'business_name',d.business_name,'created_at',d.created_at,'read_at',d.read_at,'dismissed_at',d.dismissed_at) ORDER BY d.created_at DESC,d.id DESC) FROM (SELECT mn2.id,mn2.merchant_id,COALESCE(NULLIF(BTRIM(m.business_name),''),'Unnamed Store') business_name,mn2.created_at,mn2.read_at,mn2.dismissed_at FROM public.merchant_notifications mn2 JOIN public.merchants m ON m.id=mn2.merchant_id WHERE mn2.notification_id=n.id ORDER BY mn2.created_at DESC,mn2.id DESC LIMIT 100) d),'[]'::jsonb) ELSE '[]'::jsonb END)
  INTO result FROM public.notifications n LEFT JOIN public.merchant_notifications mn ON mn.notification_id=n.id WHERE n.id=p_notification_id GROUP BY n.id;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_scheduled_notification_worker_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.admin_notification_worker_health%ROWTYPE; critical boolean; warning boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'operations.read') THEN RAISE EXCEPTION 'Operations access required' USING ERRCODE='42501'; END IF;
  SELECT * INTO h FROM public.admin_notification_worker_health WHERE singleton;
  SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.delivery_state='failed' AND n.delivery_failed_at>statement_timestamp()-interval '24 hours') OR EXISTS(SELECT 1 FROM public.admin_notification_push_outbox WHERE status='unknown') OR (h.last_failed_at IS NOT NULL AND h.last_failed_at>COALESCE(h.last_succeeded_at,'-infinity'::timestamptz)) INTO critical;
  SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.delivery_state='pending' AND n.scheduled_for<statement_timestamp()-interval '15 minutes') OR EXISTS(SELECT 1 FROM public.admin_notification_push_outbox WHERE status='dispatching') INTO warning;
  RETURN jsonb_build_object('check_name','Scheduled notification worker','status',CASE WHEN critical THEN 'critical' WHEN warning OR h.singleton IS NULL OR h.last_started_at<statement_timestamp()-interval '15 minutes' THEN 'warning' ELSE 'healthy' END,'message',CASE WHEN critical THEN 'A scheduled notification failed or has an unknown push outcome.' WHEN warning THEN 'Scheduled notification delivery is overdue or needs provider review.' WHEN h.singleton IS NULL OR h.last_started_at<statement_timestamp()-interval '15 minutes' THEN 'No recent scheduled notification worker heartbeat was recorded.' ELSE 'Scheduled notification worker is active.' END,'details',jsonb_build_object('probe','worker_heartbeat_and_delivery_state'));
END; $$;

DROP FUNCTION IF EXISTS public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]);
CREATE FUNCTION public.get_claimed_notification_push_tokens_v1(p_notification_id uuid,p_claim_token uuid,p_merchant_ids uuid[])
RETURNS TABLE(push_token text,quiet_hours_start time,quiet_hours_end time)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()),'')<>'service_role' OR p_claim_token IS NULL OR p_merchant_ids IS NULL OR COALESCE(cardinality(p_merchant_ids),0)>100 THEN RAISE EXCEPTION 'Invalid notification push token request' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification_id AND n.delivery_state='processing' AND n.sent_at IS NULL AND n.delivery_claim_token=p_claim_token) THEN RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE='P0002'; END IF;
  RETURN QUERY SELECT DISTINCT t.token,p.quiet_hours_start,p.quiet_hours_end FROM public.push_tokens t JOIN public.admin_notification_audience_snapshot a ON a.merchant_id=t.merchant_id LEFT JOIN public.notification_preferences p ON p.merchant_id=t.merchant_id WHERE a.notification_id=p_notification_id AND a.claim_token=p_claim_token AND a.merchant_id=ANY(p_merchant_ids) AND t.is_active IS TRUE AND t.app_type='admin';
END; $$;

CREATE OR REPLACE FUNCTION public.defer_notification_push_tokens_v1(p_notification_id uuid,p_claim_token uuid,p_tokens text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count_rows integer;
BEGIN
  IF COALESCE((SELECT auth.role()),'')<>'service_role' OR p_claim_token IS NULL OR COALESCE(cardinality(p_tokens),0)>100 THEN RAISE EXCEPTION 'Invalid notification push deferral' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification_id AND n.delivery_state='processing' AND n.sent_at IS NULL AND n.delivery_claim_token=p_claim_token) THEN RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.admin_notification_push_outbox(notification_id,push_token,status,claim_token) SELECT p_notification_id,token,'pending',NULL FROM unnest(COALESCE(p_tokens,'{}'::text[])) item(token) ON CONFLICT(notification_id,push_token) DO NOTHING;
  GET DIAGNOSTICS count_rows=ROW_COUNT; RETURN count_rows;
END; $$;
REVOKE ALL ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]),public.defer_notification_push_tokens_v1(uuid,uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_claimed_notification_push_tokens_v1(uuid,uuid,uuid[]),public.defer_notification_push_tokens_v1(uuid,uuid,text[]) TO service_role;
COMMIT;
