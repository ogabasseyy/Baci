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

-- Separate partners and workers with the same phone number.
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES('efae0000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','worker-b@example.test','test',now(),now(),now(),'{}','{}');
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES('efae0000-0000-4000-8000-000000000012','efae0000-0000-4000-8000-000000000004','worker-b@example.test','Other merchant','oxygen-other-worker-isolation');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES('efae0000-0000-4000-8000-000000000022','efae0000-0000-4000-8000-000000000012','efae0000-0000-4000-8000-000000000002','Other','Customer','saved-plan-stranger@example.test');
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000004',true);
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES('efae0000-0000-4000-8000-000000000032','efae0000-0000-4000-8000-000000000012','efae0000-0000-4000-8000-000000000022','OXYGEN-OTHER-WORKER',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES('efae0000-0000-4000-8000-000000000042','efae0000-0000-4000-8000-000000000032','efae0000-0000-4000-8000-000000000012','efae0000-0000-4000-8000-000000000022');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('other-partner','efae0000-0000-4000-8000-000000000004');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES('efae0000-0000-4000-8000-000000000012','efae0000-0000-4000-8000-000000000004','other-partner',true);
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES
('efae0000-0000-4000-8000-000000000041','{"phone":"2348010000000","applicationReference":"application-a","bookingReference":"efae0000-0000-4000-8000-000000000071"}'),
('efae0000-0000-4000-8000-000000000042','{"phone":"2348010000000","applicationReference":"application-b","bookingReference":"efae0000-0000-4000-8000-000000000072"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-a","deduplicationKey":"same-event"}');
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000004',true);
SELECT public.oxygen_callback('accept','other-partner','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-b","deduplicationKey":"same-event"}');
RESET ROLE;
INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status)
VALUES('response-evidence-fixture','production','foreign-env',decode(repeat('00',32),'hex'),'{"kind":"address","phoneNumber":"08010000000"}','queued');
SELECT set_config('test.b.id',id::text,true),set_config('test.b.retry',retry_key::text,true) FROM oxygen_private.callback_inbox WHERE partner_reference='other-partner' AND deduplication_key='same-event';
SELECT set_config('test.foreign.env.id',id::text,true),set_config('test.foreign.env.retry',retry_key::text,true) FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND environment='production' AND deduplication_key='foreign-env';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE jobs jsonb; BEGIN
 BEGIN
  PERFORM public.oxygen_callback('accept','other-partner','{"kind":"transaction","bookedLoanReference":"efae0000-0000-4000-8000-000000000072","deduplicationKey":"foreign-worker"}');
  RAISE EXCEPTION 'Worker accepted callback for another partner';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- Authenticated callbacks without a partner field are hints only. A foreign
 -- booking reference must not resolve to another partner's workflow.
 PERFORM public.oxygen_callback('accept','response-evidence-fixture','{"kind":"transaction","bookedLoanReference":"efae0000-0000-4000-8000-000000000072","deduplicationKey":"foreign-reference"}');
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{"kind":"transaction"}');
 IF jsonb_array_length(jobs)<>0 THEN RAISE EXCEPTION 'Foreign booking became a reconciliation candidate'; END IF;
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{"kind":"address"}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->'workflowIds'<>'["efae0000-0000-4000-8000-000000000041"]'::jsonb THEN RAISE EXCEPTION 'Cross-partner or environment candidate leakage'; END IF;
 BEGIN PERFORM public.oxygen_callback('pending','other-partner','{}'); RAISE EXCEPTION 'Worker read another partner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',current_setting('test.b.id'),'retryKey',current_setting('test.b.retry')));
 PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',current_setting('test.foreign.env.id'),'retryKey',current_setting('test.foreign.env.retry')));
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000042',current_setting('test.b.id')::uuid,current_setting('test.b.retry')::uuid); RAISE EXCEPTION 'Worker accessed foreign workflow'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.callback_inbox WHERE id=current_setting('test.b.id')::uuid)<>'queued' THEN RAISE EXCEPTION 'Other partner callback modified'; END IF;
 IF (SELECT attempts FROM oxygen_private.callback_inbox WHERE id=current_setting('test.foreign.env.id')::uuid)<>0 THEN RAISE EXCEPTION 'Other environment callback modified'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000004',true);
DO $$ DECLARE jobs jsonb; BEGIN
 jobs:=public.oxygen_callback('pending','other-partner','{"kind":"address"}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->'workflowIds'<>'["efae0000-0000-4000-8000-000000000042"]'::jsonb THEN RAISE EXCEPTION 'Worker B candidates crossed tenant boundary'; END IF;
 BEGIN PERFORM public.oxygen_callback('pending','response-evidence-fixture','{}'); RAISE EXCEPTION 'Worker B read partner A'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- One partner reference maps to one worker; a second worker cannot be
-- attached indirectly to a merchant under that partner either.
DO $$ BEGIN
 BEGIN INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000004'); RAISE EXCEPTION 'Second worker mapped to same partner'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN UPDATE oxygen_private.runtime_bindings SET partner_reference='response-evidence-fixture' WHERE merchant_id='efae0000-0000-4000-8000-000000000012'; RAISE EXCEPTION 'Other worker attached to partner'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
ROLLBACK;
