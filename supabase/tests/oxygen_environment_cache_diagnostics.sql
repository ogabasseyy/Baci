-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efac0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','booking-block-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','booking-block-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','booking-block-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','booking-block-merchant@example.test','Booking block fixture','oxygen-booking-block-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efac0000-0000-4000-8000-000000000021','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000001','Test','Customer','booking-block-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES ('booking-block-test-partner','efac0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','booking-block-test-partner',true);
UPDATE oxygen_private.runtime_bindings SET environment='production' WHERE partner_reference='booking-block-test-partner';
UPDATE public.oxygen_workflows SET environment='production' WHERE id='efac0000-0000-4000-8000-000000000041';
UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id='efac0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES
 ('efac0000-0000-4000-8000-000000000041','{"applicationReference":"efac0000-0000-4000-8000-000000000071","validated":true,"eligible":true}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efac0000-0000-4000-8000-000000000051','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000061',0,'web','{"action":"book","equityPercentage":35,"tenure":3}','executing');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_finish_failure('efac0000-0000-4000-8000-000000000051','failed','plan_required',
 '{"operation":"book","kind":"http","outcome":"rejected","httpStatus":400,"providerCode":null,"providerMessage":"Different rejection","providerRequestId":null,"capture":"parsed","occurredAt":"2026-10-23T14:51:12Z","durationMs":100}');
DO $$ BEGIN
 IF jsonb_array_length(public.oxygen_error_report('efac0000-0000-4000-8000-000000000041'))<>1 THEN RAISE EXCEPTION 'Production diagnostic missing'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041')->'plans'<>'[]'::jsonb THEN RAISE EXCEPTION 'Production saved plans missing'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.runtime_bindings SET environment='staging' WHERE partner_reference='booking-block-test-partner';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_saved_plans('efac0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Mismatch allowed saved plans'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_error_report('efac0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Mismatch allowed diagnostics'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
