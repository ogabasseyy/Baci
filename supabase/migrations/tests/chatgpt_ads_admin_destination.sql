-- Disposable SQL regression for the active operator RPC. All fixtures roll back.
BEGIN;
INSERT INTO private.audit_event_writer_capabilities(capability_name)
VALUES ('canonical_audit_event_writer_v1') ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id) VALUES
 ('7e3f2e50-bbbb-4000-8000-000000000001'),
 ('7e3f2e50-bbbb-4000-8000-000000000002');
SELECT set_config('app.audit_actor_user_id','7e3f2e50-bbbb-4000-8000-000000000001',true);
INSERT INTO public.platform_admin_memberships(user_id,role,reason) VALUES
 ('7e3f2e50-bbbb-4000-8000-000000000001','operations','Synthetic SQL regression'),
 ('7e3f2e50-bbbb-4000-8000-000000000002','viewer','Synthetic SQL regression');
SELECT pgmq.create('domain_events');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $fixture$
DECLARE queued record;
BEGIN
 SELECT * INTO queued FROM public.enqueue_domain_event_v1(
  'worker','server','chatgpt-admin-sql-order','chatgpt-admin-sql-external',
  'analytics.purchase.completed.v1','order','chatgpt-admin-sql-order',
  NULL,'{}','{"order_id":"chatgpt-admin-sql-order"}',
  '{"environment":"test"}',now());
 PERFORM public.route_domain_event_v1(queued.queue_message_id,queued.domain_event_id,ARRAY['chatgpt'],false,ARRAY['chatgpt']);
 UPDATE public.event_deliveries SET status='dead_letter',last_error_code='provider_http_400'
 WHERE domain_event_id=queued.domain_event_id AND destination='chatgpt';
END
$fixture$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','7e3f2e50-bbbb-4000-8000-000000000001',true);
DO $operator$
DECLARE result jsonb;
BEGIN
 result:=public.list_event_pipeline_deliveries_admin_v3('dead_letter',50,0,'chatgpt');
 IF (result->>'count')::integer<>1 OR result->'items'->0->>'destination' IS DISTINCT FROM 'chatgpt' THEN
  RAISE EXCEPTION 'ChatGPT dead-letter diagnostics missing';
 END IF;
 result:=public.list_event_pipeline_deliveries_admin_v3('delivery_unknown',50,0,'chatgpt');
 IF (result->>'count')::integer<>0 THEN RAISE EXCEPTION 'Unknown-delivery filter changed'; END IF;
 BEGIN
  PERFORM public.list_event_pipeline_deliveries_admin_v3('dead_letter',50,0,'unsupported');
  RAISE EXCEPTION 'Invalid destination accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END
$operator$;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-bbbb-4000-8000-000000000002',true);
DO $denied$
BEGIN
 BEGIN
  PERFORM public.list_event_pipeline_deliveries_admin_v3('dead_letter',50,0,'chatgpt');
  RAISE EXCEPTION 'Viewer gained operations permission';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$denied$;
ROLLBACK;
