-- Disposable database only. Synthetic owner/other-tenant and OAuth fixtures.
BEGIN;
INSERT INTO private.audit_event_writer_capabilities(capability_name) VALUES('canonical_audit_event_writer_v1') ON CONFLICT DO NOTHING;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) VALUES
('7e3f2e50-bbbb-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','x-owner@example.com','test',now(),now(),now(),'{}','{}'),
('7e3f2e50-bbbb-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','x-other@example.com','test',now(),now(),now(),'{}','{}');
SELECT set_config('app.audit_actor_user_id','7e3f2e50-bbbb-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug,country) VALUES('7e3f2e50-bbbb-4000-8000-000000000003','7e3f2e50-bbbb-4000-8000-000000000001','x-store@example.com','X Test Store','x-test-store','Nigeria');
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.merchants,public.staff_members TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.merchant_feature_settings TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-bbbb-4000-8000-000000000001',true);
SELECT public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003','abc','{"purchase":"tw-abc-paid","addToCart":"tw-abc-cart"}','{"consumerKey":"synthetic-key","consumerSecret":"synthetic-secret","accessToken":"synthetic-token","accessTokenSecret":"synthetic-token-secret"}',false);
SELECT public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003','abc','{"purchase":"tw-abc-paid"}',NULL,false);
DO $owner$
BEGIN
 IF (SELECT twitter_event_ids->>'purchase' FROM public.merchant_feature_settings WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003') IS DISTINCT FROM 'tw-abc-paid' THEN RAISE EXCEPTION 'event map missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003') THEN RAISE EXCEPTION 'credential presence unavailable';END IF;
 BEGIN PERFORM consumer_secret FROM public.merchant_x_ads_credentials;RAISE EXCEPTION 'saved OAuth secret readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003','abc','{"purchase":"tw-victim-paid"}',NULL,false);RAISE EXCEPTION 'cross-pixel mapping accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003','abc','{}','{"consumerKey":"only-one"}',false);RAISE EXCEPTION 'partial credentials accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN UPDATE public.merchant_feature_settings SET twitter_event_ids='{"secret":"must-not-project"}' WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003';RAISE EXCEPTION 'direct write bypassed public map validation';EXCEPTION WHEN check_violation THEN NULL;END;
END $owner$;
RESET ROLE;
DO $preserved$ BEGIN IF (SELECT consumer_secret FROM public.merchant_x_ads_credentials WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003') IS DISTINCT FROM 'synthetic-secret' THEN RAISE EXCEPTION 'blank save erased key';END IF;END $preserved$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-bbbb-4000-8000-000000000002',true);
DO $other$ BEGIN
 IF EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003') THEN RAISE EXCEPTION 'other tenant sees credential presence';END IF;
 BEGIN PERFORM public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003','abc','{}',NULL,false);RAISE EXCEPTION 'other tenant mutated settings';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $other$;
RESET ROLE;
DO $public$ DECLARE projected jsonb; BEGIN
 IF has_column_privilege('authenticated','public.merchant_x_ads_credentials','consumer_secret','SELECT') OR has_table_privilege('anon','public.merchant_x_ads_credentials','SELECT') THEN RAISE EXCEPTION 'secret read privilege';END IF;
 SELECT public.merchant_feature_settings_public_cache_projection(fs) INTO projected FROM public.merchant_feature_settings fs WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003';
 IF projected->'twitter_event_ids'->>'purchase' IS DISTINCT FROM 'tw-abc-paid' THEN RAISE EXCEPTION 'public event mapping missing';END IF;
 IF projected::text LIKE '%synthetic-%' THEN RAISE EXCEPTION 'credential in public projection';END IF;
END $public$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','7e3f2e50-bbbb-4000-8000-000000000001',true);
SELECT public.save_x_ads_settings('7e3f2e50-bbbb-4000-8000-000000000003',NULL,'{}',NULL,true);
DO $disconnect$ BEGIN IF EXISTS(SELECT 1 FROM public.merchant_x_ads_credentials WHERE merchant_id='7e3f2e50-bbbb-4000-8000-000000000003') THEN RAISE EXCEPTION 'disconnect retained access';END IF;END $disconnect$;
RESET ROLE;
ROLLBACK;
