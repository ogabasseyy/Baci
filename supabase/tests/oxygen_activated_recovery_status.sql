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
UPDATE public.orders SET payment_method='oxygen' WHERE id='efae0000-0000-4000-8000-000000000031';
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','response-evidence-fixture',true);
UPDATE public.oxygen_workflows SET stage='activated',version=4 WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"ACTIVATED","loan_reference":"efae0000-0000-4000-8000-000000000071"},"paymentComplete":true,"setupComplete":true}');
INSERT INTO oxygen_private.payment_recovery(id,workflow_id,booking_reference,expected_version,idempotency_key,action,status,result)
VALUES ('efae0000-0000-4000-8000-000000000090','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071',3,'efae0000-0000-4000-8000-000000000091','check_status','succeeded','{"paymentComplete":false,"setupComplete":false}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');
 IF r->'paymentComplete'<>'true'::jsonb OR r->'setupComplete'<>'true'::jsonb OR r->'paymentUrl'<>'null'::jsonb OR r->'setupUrl'<>'null'::jsonb THEN RAISE EXCEPTION 'Activated cached status incomplete or payable'; END IF;
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":4,"idempotencyKey":"efae0000-0000-4000-8000-000000000092","action":"check_status"}'); RAISE EXCEPTION 'Activated workflow initiated provider request'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{setupComplete}','false'::jsonb) WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Inconsistent activation reported paid'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{setupComplete}','true'::jsonb) WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.runtime_bindings SET environment='production' WHERE merchant_id='efae0000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Environment mismatch read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.runtime_bindings SET environment='staging' WHERE merchant_id='efae0000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Foreign owner read activated status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
