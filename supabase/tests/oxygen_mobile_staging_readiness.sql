-- Disposable chronological replay only. All fixtures and calls roll back.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('efaf0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mobile-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaf0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mobile-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaf0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mobile-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000003','mobile-merchant@example.test','Mobile staging fixture','oxygen-mobile-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efaf0000-0000-4000-8000-000000000021','efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000001','Test','Customer','mobile-owner@example.test');
DO $$ BEGIN
 IF has_function_privilege('anon','public.oxygen_mobile_staging_readiness(text)','EXECUTE')
 OR has_function_privilege('service_role','public.oxygen_mobile_staging_readiness(text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.oxygen_mobile_staging_readiness(text)','EXECUTE') THEN
  RAISE EXCEPTION 'Unexpected readiness grants';
 END IF;
 IF (SELECT provolatile FROM pg_proc WHERE oid='public.oxygen_mobile_staging_readiness(text)'::regprocedure)<>'s' THEN
  RAISE EXCEPTION 'Readiness must be stable/read-only';
 END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r record; BEGIN
 SELECT * INTO STRICT r FROM public.oxygen_mobile_staging_readiness('oxygen-mobile-fixture');
 IF r.merchant_id<>'efaf0000-0000-4000-8000-000000000011' OR r.environment IS NOT NULL OR r.binding_ready THEN
  RAISE EXCEPTION 'Absent runtime must return disabled owned identity';
 END IF;
 IF EXISTS(SELECT 1 FROM public.oxygen_mobile_staging_readiness('missing-store')) THEN RAISE EXCEPTION 'Missing merchant leaked'; END IF;
 BEGIN
  PERFORM public.oxygen_mobile_staging_readiness('../invalid');
  RAISE EXCEPTION 'Invalid slug accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES('mobile-staging-fixture','efaf0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,environment,enabled)
VALUES('efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000003','mobile-staging-fixture','staging',true);
CREATE TEMP TABLE readiness_counts AS SELECT
 (SELECT count(*) FROM public.orders) AS orders,
 (SELECT count(*) FROM public.oxygen_workflows) AS workflows,
 (SELECT count(*) FROM oxygen_private.commands) AS commands;
SET LOCAL ROLE authenticated;
DO $$ DECLARE r record; BEGIN
 SELECT * INTO STRICT r FROM public.oxygen_mobile_staging_readiness('oxygen-mobile-fixture');
 IF NOT r.binding_ready OR r.environment<>'staging' THEN RAISE EXCEPTION 'Enabled owned binding missing'; END IF;
 IF to_jsonb(r) ? 'worker_user_id' OR to_jsonb(r) ? 'partner_reference' THEN RAISE EXCEPTION 'Private identity leaked'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.oxygen_mobile_staging_readiness('oxygen-mobile-fixture')) THEN RAISE EXCEPTION 'Foreign customer gained access'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_mobile_staging_readiness('oxygen-mobile-fixture');
  RAISE EXCEPTION 'Missing auth accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.runtime_bindings SET enabled=false WHERE partner_reference='mobile-staging-fixture';
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT binding_ready FROM public.oxygen_mobile_staging_readiness('oxygen-mobile-fixture')) THEN RAISE EXCEPTION 'Disabled binding admitted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM readiness_counts c WHERE c.orders<>(SELECT count(*) FROM public.orders)
 OR c.workflows<>(SELECT count(*) FROM public.oxygen_workflows)
 OR c.commands<>(SELECT count(*) FROM oxygen_private.commands)) THEN RAISE EXCEPTION 'Readiness mutated workflow state'; END IF;
END $$;
ROLLBACK;
