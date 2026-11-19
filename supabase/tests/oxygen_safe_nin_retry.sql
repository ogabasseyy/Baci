-- Transactional regression. Run after the NIN retry migration.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efae0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nin-retry-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nin-retry-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efae0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nin-retry-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','nin-retry-merchant@example.test','Booking block fixture','oxygen-nin-retry-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efae0000-0000-4000-8000-000000000021','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000001','Test','Customer','nin-retry-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','OXYGEN-NIN-RETRY',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('nin-retry-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','nin-retry-fixture',true);
UPDATE public.oxygen_workflows SET stage='kyc_required',version=1 WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"applicationReference":"efae0000-0000-4000-8000-000000000071","validated":true,"eligible":true,"kyc":{"phone_status":"DONE","bvn_status":"DONE","selfie_status":"DONE","nin_status":"NOT_DONE"}}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"validate_nin"}','failed');
INSERT INTO oxygen_private.attempt_diagnostics(command_id,workflow_id,application_reference,diagnostic)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071','{"operation":"nin","outcome":"not_sent"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN IF public.oxygen_nin_retry_status('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Stranger saw retry proof'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 IF NOT public.oxygen_nin_retry_status('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Definite not-sent was not recoverable'; END IF;
 IF public.oxygen_nin_retry_status('efae0000-0000-4000-8000-000000000041',0) THEN RAISE EXCEPTION 'Stale version accepted'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.attempt_diagnostics SET diagnostic='{"operation":"nin","outcome":"indeterminate"}' WHERE command_id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_nin_retry_status('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Indeterminate retry exposed'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":1,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"validate_nin"}}');
  RAISE EXCEPTION 'Indeterminate NIN retry admitted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.attempt_diagnostics SET diagnostic='{"operation":"nin","outcome":"rejected"}' WHERE command_id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN IF oxygen_private.nin_retry_proof('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Rejected retry exposed'; END IF; END $$;
UPDATE oxygen_private.attempt_diagnostics SET diagnostic='{"operation":"nin","outcome":"not_sent"}',application_reference='efae0000-0000-4000-8000-000000000072' WHERE command_id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN IF oxygen_private.nin_retry_proof('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Wrong application accepted'; END IF; END $$;
UPDATE oxygen_private.attempt_diagnostics SET application_reference='efae0000-0000-4000-8000-000000000071' WHERE command_id='efae0000-0000-4000-8000-000000000081';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efae0000-0000-4000-8000-000000000090','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000091',1,'web','{"action":"validate_nin"}','failed');
DO $$ BEGIN IF oxygen_private.nin_retry_proof('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Older not-sent evidence reused'; END IF; END $$;
DELETE FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000090';
UPDATE oxygen_private.commands SET status='executing' WHERE id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN IF oxygen_private.nin_retry_proof('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Executing retry exposed'; END IF; END $$;
UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN IF oxygen_private.nin_retry_proof('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Indeterminate command retry exposed'; END IF; END $$;
UPDATE oxygen_private.commands SET status='failed' WHERE id='efae0000-0000-4000-8000-000000000081';
UPDATE oxygen_private.attempt_diagnostics SET diagnostic='{"operation":"nin","outcome":"not_sent"}' WHERE command_id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":1,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"validate_nin"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Proven retry not queued'; END IF;
 IF public.oxygen_nin_retry_status('efae0000-0000-4000-8000-000000000041',1) THEN RAISE EXCEPTION 'Queued NIN exposed retry'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":1,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"validate_nin"}}');
  RAISE EXCEPTION 'Queued NIN retry admitted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
