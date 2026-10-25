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
UPDATE public.oxygen_workflows SET stage='plan_required' WHERE id='efac0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES
 ('efac0000-0000-4000-8000-000000000041','{"applicationReference":"efac0000-0000-4000-8000-000000000071","validated":true,"eligible":true}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efac0000-0000-4000-8000-000000000051','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000061',0,'web','{"action":"book","equityPercentage":35,"tenure":3}','executing');
-- Exact classification: similar messages, uncertain outcomes and other
-- operations must never produce a durable active-loan block.
DO $$
DECLARE variant jsonb; cmd uuid;
BEGIN
 FOREACH variant IN ARRAY ARRAY[
  '{"operation":"book","kind":"http","outcome":"rejected","httpStatus":500,"providerMessage":"User has an active loan"}'::jsonb,
  '{"operation":"book","kind":"http","outcome":"indeterminate","httpStatus":400,"providerMessage":"User has an active loan"}'::jsonb,
  '{"operation":"eligibility","kind":"http","outcome":"rejected","httpStatus":400,"providerMessage":"User has an active loan"}'::jsonb,
  '{"operation":"book","kind":"http","outcome":"rejected","httpStatus":400,"providerMessage":"Different provider error"}'::jsonb
 ] LOOP
  cmd:=gen_random_uuid();
  INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
   VALUES(cmd,'efac0000-0000-4000-8000-000000000041',gen_random_uuid(),0,'web','{"action":"book"}','failed');
  INSERT INTO oxygen_private.attempt_diagnostics(command_id,workflow_id,diagnostic)
   VALUES(cmd,'efac0000-0000-4000-8000-000000000041',variant);
 END LOOP;
 IF EXISTS(SELECT 1 FROM oxygen_private.booking_blocks WHERE workflow_id='efac0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Unrelated failure blocked booking'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_finish_failure('efac0000-0000-4000-8000-000000000051','failed','plan_required',
 '{"operation":"book","kind":"http","outcome":"rejected","httpStatus":400,"providerCode":null,"providerMessage":"User has an active loan","providerRequestId":null,"capture":"parsed","occurredAt":"2026-10-23T14:51:12Z","durationMs":100}');
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$
DECLARE snapshot jsonb;
BEGIN
 snapshot:=public.oxygen_runtime('status','efac0000-0000-4000-8000-000000000041');
 IF snapshot->>'bookingBlock' IS DISTINCT FROM 'active_loan' THEN RAISE EXCEPTION 'Block missing after rejection'; END IF;
 IF snapshot->>'activationEnabled'<>'false' OR snapshot->>'settlementEnabled'<>'false' THEN RAISE EXCEPTION 'Financial guard changed'; END IF;
 IF snapshot::text LIKE '%User has an active loan%' THEN RAISE EXCEPTION 'Raw diagnostic leaked'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('enqueue','efac0000-0000-4000-8000-000000000041',
   '{"version":1,"idempotencyKey":"efac0000-0000-4000-8000-000000000062","command":{"action":"book","equityPercentage":35,"tenure":3}}');
  RAISE EXCEPTION 'Blocked booking accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
RESET ROLE;
-- Purging diagnostic retention and replacing provider state after a successful
-- read must not clear a separately persisted blocker.
DELETE FROM oxygen_private.attempt_diagnostics WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
UPDATE oxygen_private.provider_states SET state='{"eligible":true,"eligibilityStatus":"completed"}' WHERE workflow_id='efac0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES ('efac0000-0000-4000-8000-000000000052','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000063',1,'web','{"action":"book"}','queued');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_runtime('claim','efac0000-0000-4000-8000-000000000052','{"commandId":"efac0000-0000-4000-8000-000000000052"}');
  RAISE EXCEPTION 'Worker claimed blocked booking';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF public.oxygen_runtime('status','efac0000-0000-4000-8000-000000000041')->>'bookingBlock' IS DISTINCT FROM 'active_loan' THEN RAISE EXCEPTION 'Block lost after reload'; END IF;
 BEGIN
  PERFORM code FROM oxygen_private.booking_blocks;
  RAISE EXCEPTION 'Customer accessed private blocks';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.oxygen_runtime('status','efac0000-0000-4000-8000-000000000041');
  RAISE EXCEPTION 'Other customer read block';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
