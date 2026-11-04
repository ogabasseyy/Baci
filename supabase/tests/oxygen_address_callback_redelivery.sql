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
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','response-evidence-fixture',true);

DO $$ BEGIN
 FOR n IN 2..7 LOOP
 INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
 VALUES (('efae0000-0000-4000-8000-00000000003'||n)::uuid,'efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','CALLBACK-REF-'||n,400000,'NGN','unpaid','oxygen');
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
DO $$ DECLARE first jsonb; repeated jsonb; jobs jsonb; id uuid; old_retry uuid; new_retry uuid;
 payload jsonb:='{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":false,"deduplicationKey":"address:test-false","action":"reconcile_kyc"}'::jsonb;
 changed jsonb:='{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"address:test-true","action":"reconcile_kyc"}'::jsonb;
 BEGIN
 first:=public.oxygen_callback('accept','response-evidence-fixture',payload);
 repeated:=public.oxygen_callback('accept','response-evidence-fixture',payload);
 IF first->>'result'<>'accepted' OR repeated->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Duplicate not coalesced'; END IF;
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 THEN RAISE EXCEPTION 'Duplicate queued more than once'; END IF;
 id:=(jobs->0->>'id')::uuid; old_retry:=(jobs->0->>'retryKey')::uuid;
 PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',id,'retryKey',old_retry));
 repeated:=public.oxygen_callback('accept','response-evidence-fixture',payload);
 IF repeated->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Repeat acknowledgement changed'; END IF;
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->>'id'<>id::text THEN RAISE EXCEPTION 'Later identical signal lost'; END IF;
 new_retry:=(jobs->0->>'retryKey')::uuid;
 IF new_retry=old_retry THEN RAISE EXCEPTION 'Retry generation reused'; END IF;
 PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',id,'retryKey',old_retry));
 PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',id,'retryKey',old_retry));
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->>'retryKey'<>new_retry::text THEN RAISE EXCEPTION 'Stale completion retired new signal'; END IF;
 IF public.oxygen_callback('accept','response-evidence-fixture',changed)->>'result'<>'accepted' THEN RAISE EXCEPTION 'Changed status was collapsed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture')<>2 THEN RAISE EXCEPTION 'Unexpected number of rows'; END IF;
END $$;
ROLLBACK;
