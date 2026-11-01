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
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021');

UPDATE public.oxygen_workflows SET stage='reconciliation_required' WHERE id='efad0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('OXYGEN-RETRY-TEST','efad0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled)
 VALUES('efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000003','OXYGEN-RETRY-TEST',true);
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efad0000-0000-4000-8000-000000000041',
 '{"bookingReference":"efad0000-0000-4000-8000-000000000071","activityToken":"synthetic-only","kyc":{"address_status":"DONE"},"booking":{"loan_reference":"efad0000-0000-4000-8000-000000000071","status":"BOOKED","product_amount":400000}}');
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
SELECT oxygen_private.authorize_staging_approval_retry('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000071',0,'Synthetic provider authorization for this test');
DO $$ DECLARE s jsonb; BEGIN
 SELECT state INTO s FROM oxygen_private.provider_states WHERE workflow_id='efad0000-0000-4000-8000-000000000041';
 IF s ? 'activityToken' OR s->'booking'->>'status'<>'BOOKED' OR s->>'bookingReference'<>'efad0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Booking changed or old token reused'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.oxygen_workflows WHERE id='efad0000-0000-4000-8000-000000000041' AND stage='approval_required' AND version=1) THEN RAISE EXCEPTION 'UI recovery state missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='efad0000-0000-4000-8000-000000000081' AND status='superseded') THEN RAISE EXCEPTION 'Old attempt not superseded'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.approval_retry_authorizations WHERE command_id='efad0000-0000-4000-8000-000000000081' AND previous_status='indeterminate' AND previous_stage='reconciliation_required') THEN RAISE EXCEPTION 'Original uncertainty not audited'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.attempt_diagnostics WHERE command_id='efad0000-0000-4000-8000-000000000081' AND diagnostic->>'httpStatus'='500') THEN RAISE EXCEPTION 'Original failure evidence changed'; END IF;
 -- The next OTP uses the ordinary command queue and cannot repeat on one key.
 INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command)
 VALUES('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000092',1,'web','{"action":"trigger_approval_otp"}');
 BEGIN
  PERFORM oxygen_private.authorize_staging_approval_retry('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000071',1,'Synthetic provider authorization for this test');
  RAISE EXCEPTION 'Authorization replay accepted';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
ROLLBACK;
