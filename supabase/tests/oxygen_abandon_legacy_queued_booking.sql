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
UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"applicationReference":"efae0000-0000-4000-8000-000000000071"}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"book"}','queued',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Foreign owner retired command'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=state || '{"offers":[{"tenure":3,"loanAmount":100000}]}'::jsonb WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Approval with offers retired'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=state-'offers' WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.commands SET command='{}' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Null action retired command'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE id='efae0000-0000-4000-8000-000000000081';
UPDATE public.oxygen_workflows SET stage='booked' WHERE id='efae0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.provider_states SET state=state || '{"bookingReference":"existing","booking":{"status":"BOOKED"},"activityToken":"active"}'::jsonb WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Active approval booking retired'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.provider_states SET state=state-'activityToken' WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Existing booking not retired'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='queued',completed_at=NULL WHERE id='efae0000-0000-4000-8000-000000000081';
UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id='efae0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.provider_states SET state=state-'bookingReference'-'booking' WHERE workflow_id='efae0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval(NULL,0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Null workflow retired command'; END IF;
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',NULL,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Null version retired command'; END IF;
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,NULL) THEN RAISE EXCEPTION 'Null key retired command'; END IF;
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',1,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Wrong version retired command'; END IF;
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000083') THEN RAISE EXCEPTION 'Wrong key retired command'; END IF;
 IF NOT public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Queued booking not retired'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF oxygen_private.claim_command('efae0000-0000-4000-8000-000000000081') IS NOT NULL THEN RAISE EXCEPTION 'Retired command was claimed'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='queued',completed_at=NULL WHERE id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN
 IF oxygen_private.claim_command('efae0000-0000-4000-8000-000000000081') IS NULL THEN RAISE EXCEPTION 'Claim failed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Claimed command retired'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_abandon_legacy_queued_approval('efae0000-0000-4000-8000-000000000041',0,'efae0000-0000-4000-8000-000000000082') THEN RAISE EXCEPTION 'Indeterminate command retired'; END IF;
END $$;
ROLLBACK;
