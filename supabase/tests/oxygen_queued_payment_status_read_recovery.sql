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
UPDATE public.oxygen_workflows SET stage='payment_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"APPROVED"}}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"refresh_payment_setup"}','queued',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_payment_setup"}}'); RAISE EXCEPTION 'Foreign customer reaped payment read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":1,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_payment_setup"}}'); RAISE EXCEPTION 'Stale version reaped payment read'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000082","command":{"action":"refresh_payment_setup"}}');
 IF r->>'status'<>'queued' OR r->>'commandId'<>'efae0000-0000-4000-8000-000000000081' THEN RAISE EXCEPTION 'Same-key resume failed'; END IF;
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_payment_setup"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Stale queued payment status not replaced'; END IF;
 PERFORM set_config('test.fresh.id',r->>'commandId',true);
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","action":"check_status"}'); RAISE EXCEPTION 'Fresh queued command retired'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('claim','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081"}');
 IF r IS NOT NULL THEN RAISE EXCEPTION 'Retired payment status claimed'; END IF;
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"ready_for_activation","state":{"paymentComplete":true,"setupComplete":true}}');
  RAISE EXCEPTION 'Late retired status result accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Command is not executing' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET created_at=now()-interval '5 minutes' WHERE id=current_setting('test.fresh.id')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","action":"check_status"}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Payment recovery could not retire stale queued read'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id=current_setting('test.fresh.id')::uuid)<>'failed' THEN RAISE EXCEPTION 'Stale queued status not retired'; END IF;
 IF (SELECT state ? 'paymentComplete' FROM oxygen_private.provider_states WHERE workflow_id='efae0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Late payment result changed canonical state'; END IF;
END $$;
UPDATE oxygen_private.payment_recovery SET status='failed' WHERE workflow_id='efae0000-0000-4000-8000-000000000041' AND status='queued';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000088','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000089',0,'web','{"action":"refresh_payment_setup"}','queued',clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"transaction","bookedLoanReference":"efae0000-0000-4000-8000-000000000071","transactionReference":"queued-read-reclaim","deduplicationKey":"queued-read-reclaim"}');
RESET ROLE;
SELECT set_config('test.callback.id',id::text,true),set_config('test.callback.retry',retry_key::text,true) FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND deduplication_key='queued-read-reclaim';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid); RAISE EXCEPTION 'Fresh queued callback fence bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"approve_booking"}',created_at=now()-interval '1 hour' WHERE id='efae0000-0000-4000-8000-000000000088';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid); RAISE EXCEPTION 'Queued financial mutation reaped'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='executing',started_at=now()-interval '1 hour' WHERE id='efae0000-0000-4000-8000-000000000088';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid); RAISE EXCEPTION 'Executing financial mutation reaped'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"refresh_payment_setup"}',status='queued',created_at=now()-interval '5 minutes' WHERE id='efae0000-0000-4000-8000-000000000088';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Callback did not recover queued status'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000088')<>'failed' THEN RAISE EXCEPTION 'Callback did not retire queued status'; END IF; END $$;
ROLLBACK;
