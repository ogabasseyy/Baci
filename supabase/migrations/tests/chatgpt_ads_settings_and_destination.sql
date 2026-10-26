-- Run only in a disposable database after 20261024160000. Synthetic fixtures.
BEGIN;
INSERT INTO private.audit_event_writer_capabilities(capability_name)
 VALUES ('canonical_audit_event_writer_v1') ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES ('7e3f2e50-aaaa-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chatgpt-owner@example.com','test',now(),now(),now(),'{}','{}'),
('7e3f2e50-aaaa-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','chatgpt-other@example.com','test',now(),now(),now(),'{}','{}');
SELECT set_config('app.audit_actor_user_id','7e3f2e50-aaaa-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug,country)
 VALUES ('7e3f2e50-aaaa-4000-8000-000000000003','7e3f2e50-aaaa-4000-8000-000000000001','chatgpt-store@example.com','ChatGPT Test Store','chatgpt-test-store','Nigeria');
-- A schema-only local clone omits old grants. Reestablish the existing owner
-- table access needed by this SECURITY INVOKER function; new secret grants
-- come from the migration under test.
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.merchants, public.staff_members TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.merchant_feature_settings TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-aaaa-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT public.save_chatgpt_ads_settings('7e3f2e50-aaaa-4000-8000-000000000003','test-pixel','synthetic-server-key',false);
SELECT public.save_chatgpt_ads_settings('7e3f2e50-aaaa-4000-8000-000000000003',NULL,'synthetic-rotated-key',false);
DO $key_only$
BEGIN
 IF (SELECT chatgpt_pixel_id FROM public.merchant_feature_settings WHERE merchant_id='7e3f2e50-aaaa-4000-8000-000000000003') IS DISTINCT FROM 'test-pixel' THEN RAISE EXCEPTION 'key-only update cleared pixel'; END IF;
END
$key_only$;
SELECT public.save_chatgpt_ads_settings('7e3f2e50-aaaa-4000-8000-000000000003','test-pixel',NULL,false);
DO $test$
BEGIN
 BEGIN
  PERFORM capi_key FROM public.merchant_chatgpt_ads_credentials;
  RAISE EXCEPTION 'saved key is readable through the authenticated Data API';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$test$;
RESET ROLE;
DO $key_preserved$
BEGIN
 IF (SELECT capi_key FROM public.merchant_chatgpt_ads_credentials WHERE merchant_id='7e3f2e50-aaaa-4000-8000-000000000003') IS DISTINCT FROM 'synthetic-rotated-key' THEN RAISE EXCEPTION 'blank key erased credential'; END IF;
END
$key_preserved$;
DO $projections$
DECLARE projected jsonb; broad jsonb;
BEGIN
 SELECT public.merchant_feature_settings_public_cache_projection(fs) INTO projected FROM public.merchant_feature_settings fs WHERE merchant_id='7e3f2e50-aaaa-4000-8000-000000000003';
 SELECT feature_settings INTO broad FROM public.resolve_storefront_cached_merchant('chatgpt-test-store');
 IF projected->>'chatgpt_pixel_id' IS DISTINCT FROM 'test-pixel' OR broad->>'chatgpt_pixel_id' IS DISTINCT FROM 'test-pixel' THEN RAISE EXCEPTION 'public pixel projection missing'; END IF;
 IF projected ? 'capi_key' OR broad ? 'capi_key' OR projected::text LIKE '%synthetic-server-key%' OR broad::text LIKE '%synthetic-server-key%' THEN RAISE EXCEPTION 'public projection leaked credential'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_events WHERE merchant_id='7e3f2e50-aaaa-4000-8000-000000000003' AND changed_fields @> ARRAY['chatgpt_pixel_id']) THEN RAISE EXCEPTION 'pixel audit change missing'; END IF;
END
$projections$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-aaaa-4000-8000-000000000002',true);
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM public.merchant_chatgpt_ads_credentials) THEN RAISE EXCEPTION 'cross tenant credential read'; END IF;
 BEGIN
  PERFORM public.save_chatgpt_ads_settings('7e3f2e50-aaaa-4000-8000-000000000003','victim-pixel','attack-key',false);
  RAISE EXCEPTION 'cross tenant credential write';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END
$test$;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-aaaa-4000-8000-000000000001',true);
SELECT public.save_chatgpt_ads_settings('7e3f2e50-aaaa-4000-8000-000000000003',NULL,NULL,true);
DO $test$
BEGIN
 IF EXISTS(SELECT 1 FROM public.merchant_chatgpt_ads_credentials) THEN RAISE EXCEPTION 'disconnect retained credential'; END IF;
 IF (SELECT chatgpt_pixel_id FROM public.merchant_feature_settings WHERE merchant_id='7e3f2e50-aaaa-4000-8000-000000000003') IS NOT NULL THEN RAISE EXCEPTION 'disconnect retained pixel'; END IF;
END
$test$;
RESET ROLE;
SELECT pgmq.create('domain_events');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $pipeline$
DECLARE queued record; duplicate record; routed record; claimed record;
BEGIN
 SELECT * INTO queued FROM public.enqueue_domain_event_v1(
  'worker','server','chatgpt-sql-order-1','purchase_sql_order_1',
  'analytics.purchase.completed.v1','order','sql-order-1',
  '7e3f2e50-aaaa-4000-8000-000000000003','{}','{"order_id":"sql-order-1"}',
  '{"environment":"test"}',now());
 SELECT * INTO duplicate FROM public.enqueue_domain_event_v1(
  'worker','server','chatgpt-sql-order-1','purchase_sql_order_1',
  'analytics.purchase.completed.v1','order','sql-order-1',
  '7e3f2e50-aaaa-4000-8000-000000000003','{}','{"order_id":"sql-order-1"}',
  '{"environment":"test"}',now());
 IF NOT duplicate.already_enqueued OR duplicate.domain_event_id<>queued.domain_event_id THEN RAISE EXCEPTION 'enqueue identity/dedup failure'; END IF;
 SELECT * INTO routed FROM public.route_domain_event_v1(queued.queue_message_id,queued.domain_event_id,ARRAY['chatgpt'],false,ARRAY['chatgpt']);
 IF routed.delivery_count<>1 THEN RAISE EXCEPTION 'chatgpt routing did not create one durable delivery'; END IF;
 SELECT * INTO claimed FROM public.claim_event_deliveries_v1(1,'chatgpt-sql-test',60);
 IF claimed.destination IS DISTINCT FROM 'chatgpt' THEN RAISE EXCEPTION 'worker did not claim chatgpt destination'; END IF;
 PERFORM public.finish_event_delivery_v1(claimed.id,claimed.claim_token,'delivered',NULL,NULL,NULL,200,'synthetic-provider-id');
 IF NOT EXISTS(SELECT 1 FROM public.event_deliveries WHERE id=claimed.id AND status='delivered') THEN RAISE EXCEPTION 'delivery receipt missing'; END IF;
END
$pipeline$;
DO $test$
DECLARE definition text; entry record;
BEGIN
 IF has_column_privilege('authenticated','public.merchant_chatgpt_ads_credentials','capi_key','SELECT') THEN RAISE EXCEPTION 'authenticated secret column grant'; END IF;
 IF has_table_privilege('anon','public.merchant_chatgpt_ads_credentials','SELECT') THEN RAISE EXCEPTION 'anonymous secret grant'; END IF;
 IF EXISTS(SELECT 1 FROM public.audit_events WHERE before_values::text LIKE '%synthetic-server-key%' OR after_values::text LIKE '%synthetic-server-key%' OR before_values::text LIKE '%synthetic-rotated-key%' OR after_values::text LIKE '%synthetic-rotated-key%' OR before_values::text LIKE '%test-pixel%' OR after_values::text LIKE '%test-pixel%') THEN RAISE EXCEPTION 'audit secret exposure'; END IF;
 FOR entry IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('route_domain_event_v1','list_event_pipeline_deliveries_v1','select_event_pipeline_replay_ids_v1') LOOP
  definition:=pg_get_functiondef(entry.oid);
  IF position($needle$'chatgpt'$needle$ in definition)=0 THEN RAISE EXCEPTION 'routing/replay destination missing'; END IF;
 END LOOP;
END
$test$;
ROLLBACK;
