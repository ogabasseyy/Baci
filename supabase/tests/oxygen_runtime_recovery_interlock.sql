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
UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"APPROVED"}}');
INSERT INTO oxygen_private.payment_recovery(id,workflow_id,booking_reference,expected_version,idempotency_key,action,status)
VALUES('efae0000-0000-4000-8000-000000000075','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071',0,'efae0000-0000-4000-8000-000000000076','resend_upfront','queued');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 PERFORM public.oxygen_runtime('status','efae0000-0000-4000-8000-000000000041');
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000077","command":{"action":"refresh_payment_setup"}}'); RAISE EXCEPTION 'Recovery queued did not fence enqueue'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.payment_recovery SET status='executing' WHERE id='efae0000-0000-4000-8000-000000000075';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('reconcile','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000078","command":{"action":"refresh_payment_setup"}}'); RAISE EXCEPTION 'Recovery executing did not fence reconcile'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efae0000-0000-4000-8000-000000000079','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000080',0,'web','{"action":"refresh_payment_setup"}','queued');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('claim','efae0000-0000-4000-8000-000000000079','{"commandId":"efae0000-0000-4000-8000-000000000079"}'); RAISE EXCEPTION 'Recovery executing did not fence claim'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000079';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041','{"commandId":"efae0000-0000-4000-8000-000000000075","outcome":"failed","result":{}}');
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000077","command":{"action":"refresh_payment_setup"}}');
END $$;
ROLLBACK;
