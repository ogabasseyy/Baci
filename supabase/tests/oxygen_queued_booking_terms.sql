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
UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"applicationReference":"efae0000-0000-4000-8000-000000000071"}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"book","equityPercentage":35,"tenure":6}','queued',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Foreign customer read terms'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082');
 IF r IS DISTINCT FROM '{"equityPercentage":35,"tenure":6}'::jsonb THEN RAISE EXCEPTION 'Incorrect terms: %',r; END IF;
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',1,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Stale version read terms'; END IF;
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000083') IS NOT NULL THEN RAISE EXCEPTION 'Wrong key read terms'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"refresh_kyc"}' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Wrong action read terms'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"book","equityPercentage":35,"tenure":6}' WHERE id='efae0000-0000-4000-8000-000000000081';
UPDATE public.oxygen_workflows SET version=1 WHERE id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Advanced workflow read old terms'; END IF;
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',1,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Stale command read terms at current version'; END IF;
END $$;
RESET ROLE;
UPDATE public.oxygen_workflows SET version=0 WHERE id='efae0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.commands SET status='executing' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Executing terms exposed'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_queued_booking_terms('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') IS NOT NULL THEN RAISE EXCEPTION 'Indeterminate terms exposed'; END IF;
END $$;
ROLLBACK;
