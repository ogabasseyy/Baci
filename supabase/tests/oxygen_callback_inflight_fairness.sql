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
DO $$ DECLARE payload jsonb:='{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"race-event","action":"reconcile_kyc"}'; jobs jsonb; old_key uuid; new_key uuid; v_id uuid; BEGIN
 PERFORM public.oxygen_callback('accept','response-evidence-fixture',payload);
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 v_id:=(jobs->0->>'id')::uuid; old_key:=(jobs->0->>'retryKey')::uuid;
 -- A new document can complete while the first hint is still in flight.
 PERFORM public.oxygen_callback('accept','response-evidence-fixture',payload);
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 new_key:=(jobs->0->>'retryKey')::uuid;
 IF new_key IS NOT DISTINCT FROM old_key THEN RAISE EXCEPTION 'In-flight identical address signal not fenced'; END IF;
 PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',v_id,'retryKey',old_key));
 PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',v_id,'retryKey',old_key));
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->>'retryKey'<>new_key::text THEN RAISE EXCEPTION 'Stale drainer consumed later signal'; END IF;
 BEGIN PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',v_id)); RAISE EXCEPTION 'Unfenced completion accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',v_id)); RAISE EXCEPTION 'Unfenced defer accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture';
INSERT INTO oxygen_private.callback_inbox(id,partner_reference,environment,deduplication_key,payload_hash,event,status,received_at,next_attempt_at) VALUES
('efae0000-0000-4000-8000-000000000081','response-evidence-fixture','staging','fair-a',decode(repeat('00',32),'hex'),'{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-1"}','queued',now()-interval '3 hours',now()-interval '10 seconds'),
('efae0000-0000-4000-8000-000000000082','response-evidence-fixture','staging','fair-b',decode(repeat('00',32),'hex'),'{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-2"}','queued',now()-interval '2 hours',now()-interval '9 seconds'),
('efae0000-0000-4000-8000-000000000083','response-evidence-fixture','staging','fair-c',decode(repeat('00',32),'hex'),'{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-3"}','queued',now()-interval '1 hour',now()-interval '2 minutes');
SET LOCAL ROLE authenticated;
DO $$ DECLARE jobs jsonb; BEGIN
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>3 OR jobs->0->>'id'<>'efae0000-0000-4000-8000-000000000083' THEN RAISE EXCEPTION 'Repeatedly deferred old jobs starve earlier-due callback'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
