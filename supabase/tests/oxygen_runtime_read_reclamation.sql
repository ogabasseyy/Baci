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
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"refresh_payment_setup"}','executing',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","action":"check_status"}');
 PERFORM set_config('test.recovery.id',r->>'commandId',true);
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.id')));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.id'),'outcome','succeeded','result','{"paymentComplete":true,"setupComplete":true}'::jsonb));
 BEGIN
  PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"ready_for_activation","state":{"paymentComplete":false,"setupComplete":false}}');
  RAISE EXCEPTION 'Late result accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Command is not executing' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000081')<>'failed' THEN RAISE EXCEPTION 'Stale command not retired'; END IF;
 IF (SELECT version FROM public.oxygen_workflows WHERE id='efae0000-0000-4000-8000-000000000041')<>0 THEN RAISE EXCEPTION 'Retirement changed version'; END IF;
 IF (SELECT state ? 'paymentComplete' FROM oxygen_private.provider_states WHERE workflow_id='efae0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Late provider state persisted'; END IF;
END $$;
-- A fresh read and an old mutation remain fenced. GET status does not retire either.
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000084','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000085',0,'web','{"action":"refresh_payment_setup"}','executing',clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 PERFORM public.oxygen_runtime('status','efae0000-0000-4000-8000-000000000041');
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000086","action":"check_status"}'); RAISE EXCEPTION 'Fresh read was reclaimed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"approve_booking"}',started_at=now()-interval '1 hour' WHERE id='efae0000-0000-4000-8000-000000000084';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000086","action":"check_status"}'); RAISE EXCEPTION 'Mutation was reclaimed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000084')<>'executing' THEN RAISE EXCEPTION 'Mutation status changed'; END IF;
END $$;
-- Explicit worker reconciliation can replace a stale payment read too.
UPDATE oxygen_private.commands SET command='{"action":"refresh_payment_setup"}',started_at=now()-interval '5 minutes' WHERE id='efae0000-0000-4000-8000-000000000084';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('reconcile','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000087","command":{"action":"refresh_payment_setup"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Reconciliation did not enqueue'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET status='failed' WHERE workflow_id='efae0000-0000-4000-8000-000000000041' AND status='queued';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000088','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000089',0,'web','{"action":"refresh_payment_setup"}','executing',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"transaction","bookedLoanReference":"efae0000-0000-4000-8000-000000000071","transactionReference":"read-reclaim","deduplicationKey":"read-reclaim"}');
RESET ROLE;
SELECT set_config('test.callback.id',id::text,true),set_config('test.callback.retry',retry_key::text,true) FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND deduplication_key='read-reclaim';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Callback could not enqueue fresh status'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000088')<>'failed' THEN RAISE EXCEPTION 'Callback did not retire stale read'; END IF;
END $$;
ROLLBACK;
