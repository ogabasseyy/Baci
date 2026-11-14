-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efad0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','approval-retry-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efad0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','approval-retry-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efad0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','approval-retry-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000003','approval-retry-merchant@example.test','Booking block fixture','oxygen-approval-retry-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efad0000-0000-4000-8000-000000000021','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000001','Test','Customer','approval-retry-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021');

UPDATE public.oxygen_workflows SET stage='reconciliation_required' WHERE id='efad0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('OXYGEN-RETRY-TEST','efad0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
 VALUES('efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000003','OXYGEN-RETRY-TEST',true);
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efad0000-0000-4000-8000-000000000041',
 '{"bookingReference":"efad0000-0000-4000-8000-000000000071","activityToken":"synthetic-only","eligibleAmount":400000,"minimumAmount":10000,"maxTenure":3,"offers":[{"tenure":3,"loanAmount":400000}],"kyc":{"address_status":"DONE"},"booking":{"loan_reference":"efad0000-0000-4000-8000-000000000071","status":"BOOKED","product_amount":400000}}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at,completed_at)
 VALUES('efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000091',0,'web','{"action":"approve_booking"}','indeterminate',now(),now());
INSERT INTO oxygen_private.attempt_diagnostics(command_id,workflow_id,diagnostic)
 VALUES('efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000041','{"operation":"approve","httpStatus":500}');
DO $$ BEGIN
 IF has_function_privilege('authenticated','oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)','EXECUTE')
 OR has_function_privilege('anon','oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)','EXECUTE')
 OR has_function_privilege('oxygen_workflow_worker','oxygen_private.authorize_staging_approval_retry(uuid,uuid,uuid,integer,text)','EXECUTE') THEN
  RAISE EXCEPTION 'App roles may not authorize approval retries';
 END IF;
 BEGIN
  PERFORM oxygen_private.authorize_staging_approval_retry('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000072',0,'Synthetic provider authorization for this test');
  RAISE EXCEPTION 'Wrong reference accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  PERFORM oxygen_private.authorize_staging_approval_retry('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000071',1,'Synthetic provider authorization for this test');
  RAISE EXCEPTION 'Stale version accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status) VALUES('efad0000-0000-4000-8000-000000000082','efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000093',0,'web','{"action":"trigger_approval_otp"}','succeeded');
SELECT oxygen_private.authorize_staging_approval_retry('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000071',0,'Synthetic provider authorization for this test');
INSERT INTO oxygen_private.saved_plans(workflow_id,booking_reference,product_amount,equity_percentage,tenure,state) VALUES
('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',400000,25,3,'{"bookingReference":"efad0000-0000-4000-8000-000000000071","booking":{"loan_reference":"efad0000-0000-4000-8000-000000000071","status":"BOOKED","loan_amount":300000,"loan_tenure":3},"schedule":[]}'),
('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000072',400000,35,3,'{"bookingReference":"efad0000-0000-4000-8000-000000000072","booking":{"loan_reference":"efad0000-0000-4000-8000-000000000072","status":"BOOKED","loan_amount":260000,"loan_tenure":3},"schedule":[]}');
-- A single successful eligibility read after authorization must preserve the exact-booking retry.
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,completed_at)
VALUES('efad0000-0000-4000-8000-000000000085','efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000095',1,'web','{"action":"refresh_eligibility"}','succeeded',now());
UPDATE public.oxygen_workflows SET version=2 WHERE id='efad0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.history(workflow_id,command_id,stage,version) VALUES('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000085','approval_required',2);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',2);
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"refresh_kyc"}' WHERE id='efad0000-0000-4000-8000-000000000085';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',2); RAISE EXCEPTION 'Unrelated command preserved authorization'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.history WHERE command_id='efad0000-0000-4000-8000-000000000085';
DELETE FROM oxygen_private.commands WHERE id='efad0000-0000-4000-8000-000000000085';
UPDATE public.oxygen_workflows SET version=1 WHERE id='efad0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',1);
 IF (r->>'version')::integer<>1 THEN RAISE EXCEPTION 'Canonical retry changed version'; END IF;
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000072',1); RAISE EXCEPTION 'Approval retry switched booking'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efad0000-0000-4000-8000-000000000084','efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000094',1,'web','{"action":"approve_booking"}','queued');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',1); RAISE EXCEPTION 'Pending financial command bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.commands WHERE id='efad0000-0000-4000-8000-000000000084';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',1); RAISE EXCEPTION 'Foreign customer accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.oxygen_workflows SET version=2 WHERE id='efad0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',2); RAISE EXCEPTION 'Expired authorization reused'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.oxygen_workflows SET version=1 WHERE id='efad0000-0000-4000-8000-000000000041';
DELETE FROM oxygen_private.approval_retry_authorizations WHERE workflow_id='efad0000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_accept_saved_plan('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000071',1); RAISE EXCEPTION 'Unauthorised retry accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
