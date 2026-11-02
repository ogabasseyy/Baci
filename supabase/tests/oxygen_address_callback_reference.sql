-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efae0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efae0000-0000-4000-8000-000000000021','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','response-evidence-fixture',true);

DO $$ BEGIN
 FOR n IN 2..7 LOOP
 INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
 VALUES (('efae0000-0000-4000-8000-00000000003'||n)::uuid,'efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','CALLBACK-REF-'||n,400000,'NGN','unpaid');
 INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
 VALUES (('efae0000-0000-4000-8000-00000000004'||n)::uuid,('efae0000-0000-4000-8000-00000000003'||n)::uuid,'efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');
 END LOOP;
END $$;
INSERT INTO oxygen_private.provider_states(workflow_id,state)
SELECT ('efae0000-0000-4000-8000-00000000004'||n)::uuid,
 jsonb_build_object('phone','2348010000000','applicationReference','application-'||n)
FROM generate_series(1,7) n;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4"}');
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"unknown"}');
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000"}');
DO $$ DECLARE jobs jsonb; BEGIN
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{"kind":"address"}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->'workflowIds'<>'["efae0000-0000-4000-8000-000000000044"]'::jsonb THEN
  RAISE EXCEPTION 'Exact reference must select only its one application; got %',jobs;
 END IF;
 IF jsonb_array_length(public.oxygen_callback('pending','response-evidence-fixture','{"kind":"address","applicationReference":"unknown"}'))<>0 THEN
  RAISE EXCEPTION 'Unknown reference fell back to phone';
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND NOT event ? 'applicationReference' AND status='observed' AND resolution_error='ambiguous_address') THEN
  RAISE EXCEPTION 'Ambiguous legacy callback was not quarantined';
 END IF;
END $$;
-- Cross-merchant/worker refusal, then unique legacy phone compatibility.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback('pending','response-evidence-fixture');
 RAISE EXCEPTION 'Customer read callback candidates'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{phone}','"2348020000000"') WHERE workflow_id='efae0000-0000-4000-8000-000000000047';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08020000000"}');
DO $$ DECLARE jobs jsonb; BEGIN
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{"kind":"address"}');
 IF jsonb_array_length(jobs)<>2 THEN RAISE EXCEPTION 'Unique legacy address callback was lost'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
