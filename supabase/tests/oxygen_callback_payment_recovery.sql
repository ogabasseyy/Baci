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
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000031','efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efae0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000003','response-evidence-fixture',true);
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000091',0,'web','{"action":"approve_booking"}','indeterminate',now());

UPDATE public.oxygen_workflows SET stage='reconciliation_required',version=3 WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"BOOKED"}}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"transaction","bookedLoanReference":"efae0000-0000-4000-8000-000000000071","transactionReference":"callback-test","deduplicationKey":"callback-test"}');
RESET ROLE;
SELECT set_config('test.callback.id',id::text,true),set_config('test.callback.retry',retry_key::text,true) FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN
 PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 RAISE EXCEPTION 'Customer enqueued callback recovery';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 BEGIN
 PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,'efae0000-0000-4000-8000-000000000099');
 RAISE EXCEPTION 'Wrong retry accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000042',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 RAISE EXCEPTION 'Wrong workflow accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 r:=public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 IF r->>'reference'<>'efae0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Wrong booking'; END IF;
 IF public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid)<>r THEN RAISE EXCEPTION 'Callback replay not idempotent'; END IF;
 PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',r->>'commandId'));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',r->>'commandId','outcome','succeeded','result','{"paymentComplete":true,"setupComplete":true}'::jsonb));
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');
 IF r->>'paymentComplete'<>'true' OR r->>'setupComplete'<>'true' THEN RAISE EXCEPTION 'Customer did not see callback status'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
UPDATE oxygen_private.callback_inbox SET event=jsonb_set(event,'{bookedLoanReference}','"efae0000-0000-4000-8000-000000000072"') WHERE id=current_setting('test.callback.id')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 RAISE EXCEPTION 'Mismatched booking accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.callback_inbox SET event=jsonb_set(event,'{bookedLoanReference}','"efae0000-0000-4000-8000-000000000071"') WHERE id=current_setting('test.callback.id')::uuid;
UPDATE oxygen_private.commands SET command='{"action":"book_plan"}' WHERE id='efae0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback_payment('efae0000-0000-4000-8000-000000000041',current_setting('test.callback.id')::uuid,current_setting('test.callback.retry')::uuid);
 RAISE EXCEPTION 'Uncertain booking bypassed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"approve_booking"}' WHERE id='efae0000-0000-4000-8000-000000000081';
DO $$ BEGIN
 IF (SELECT stage FROM public.oxygen_workflows WHERE id='efae0000-0000-4000-8000-000000000041')<>'reconciliation_required' OR
 (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000081')<>'indeterminate' THEN RAISE EXCEPTION 'Approval hold changed'; END IF;
 IF has_function_privilege('anon','public.oxygen_callback_payment(uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous callback permission'; END IF;
END $$;
ROLLBACK;
