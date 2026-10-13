-- Preserve notification lifecycle fields and keep quiet-hour push deferrals
-- out of the provider-outcome failure path.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_admin_notification_detail(p_notification_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb; can_read boolean:=false;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT private.has_platform_admin_permission_v1((SELECT auth.uid()),'notifications.manage') THEN RAISE EXCEPTION 'Platform admin access required' USING ERRCODE='42501'; END IF;
  can_read:=private.has_platform_admin_permission_v1((SELECT auth.uid()),'merchants.read');
  SELECT jsonb_build_object(
    'notification',jsonb_build_object('id',n.id,'template_id',n.template_id,'title',n.title,'message',n.message,'notification_type',n.notification_type,'priority',n.priority,'target_type',n.target_type,'target_merchant_ids',CASE WHEN can_read THEN n.target_merchant_ids ELSE '{}'::uuid[] END,'target_segment',n.target_segment,'channels',n.channels,'action_url',n.action_url,'action_label',n.action_label,'scheduled_for',n.scheduled_for,'expires_at',n.expires_at,'created_by',n.created_by,'created_at',n.created_at,'sent_at',n.sent_at,'is_system',n.is_system,'delivery_state',n.delivery_state,'delivery_attempts',n.delivery_attempts,'delivery_last_error',n.delivery_last_error),
    'stats',jsonb_build_object('total_sent',COUNT(mn.id),'total_push_sent',(SELECT COUNT(*) FROM public.admin_notification_push_outbox p WHERE p.notification_id=n.id AND p.status='accepted'),'total_read',COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL),'total_dismissed',COUNT(mn.id) FILTER (WHERE mn.dismissed_at IS NOT NULL),'read_rate',CASE WHEN COUNT(mn.id)>0 THEN ROUND((COUNT(mn.id) FILTER (WHERE mn.read_at IS NOT NULL))::numeric/COUNT(mn.id)*100,2) ELSE 0 END),
    'deliveries',CASE WHEN can_read THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'merchant_id',d.merchant_id,'business_name',d.business_name,'created_at',d.created_at,'read_at',d.read_at,'dismissed_at',d.dismissed_at) ORDER BY d.created_at DESC,d.id DESC) FROM (SELECT mn2.id,mn2.merchant_id,COALESCE(NULLIF(BTRIM(m.business_name),''),'Unnamed Store') business_name,mn2.created_at,mn2.read_at,mn2.dismissed_at FROM public.merchant_notifications mn2 JOIN public.merchants m ON m.id=mn2.merchant_id WHERE mn2.notification_id=n.id ORDER BY mn2.created_at DESC,mn2.id DESC LIMIT 100) d),'[]'::jsonb) ELSE '[]'::jsonb END)
  INTO result FROM public.notifications n LEFT JOIN public.merchant_notifications mn ON mn.notification_id=n.id WHERE n.id=p_notification_id GROUP BY n.id;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_notification_push_outbox_summary_v1(p_notification_id uuid, p_claim_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Service role claim required' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object('pending', COUNT(*) FILTER (WHERE status = 'pending' AND error_code IS DISTINCT FROM 'quiet_hours_deferred'),
    'dispatching', COUNT(*) FILTER (WHERE status = 'dispatching'),
    'rejected', COUNT(*) FILTER (WHERE status = 'rejected'),
    'unknown', COUNT(*) FILTER (WHERE status = 'unknown'))
    FROM public.admin_notification_push_outbox WHERE notification_id = p_notification_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.defer_notification_push_tokens_v1(p_notification_id uuid,p_claim_token uuid,p_tokens text[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE count_rows integer;
BEGIN
  IF COALESCE((SELECT auth.role()),'')<>'service_role' OR p_claim_token IS NULL OR COALESCE(cardinality(p_tokens),0)>100 THEN RAISE EXCEPTION 'Invalid notification push deferral' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.id=p_notification_id AND n.delivery_state='processing' AND n.sent_at IS NULL AND n.delivery_claim_token=p_claim_token) THEN RAISE EXCEPTION 'Notification claim is no longer active' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.admin_notification_push_outbox(notification_id,push_token,status,claim_token,error_code)
    SELECT p_notification_id,token,'pending',NULL,'quiet_hours_deferred'
    FROM unnest(COALESCE(p_tokens,'{}'::text[])) item(token)
    ON CONFLICT(notification_id,push_token) DO UPDATE SET status='pending',claim_token=NULL,error_code='quiet_hours_deferred',updated_at=statement_timestamp()
      WHERE public.admin_notification_push_outbox.status='pending';
  GET DIAGNOSTICS count_rows=ROW_COUNT; RETURN count_rows;
END; $$;

COMMIT;
