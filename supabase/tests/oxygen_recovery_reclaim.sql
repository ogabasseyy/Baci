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
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000091',0,'web','{"action":"approve_booking"}','indeterminate',now());

UPDATE public.oxygen_workflows SET stage='reconciliation_required',version=3 WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"BOOKED"}}');

INSERT INTO oxygen_private.payment_recovery(id,workflow_id,booking_reference,expected_version,idempotency_key,action,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000099','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071',3,'efae0000-0000-4000-8000-000000000098','check_status','executing',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000097","action":"check_status"}');
 PERFORM set_config('test.fresh',r->>'commandId',true);
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.fresh')));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.fresh'),'outcome','succeeded','result','{"paymentComplete":true,"setupComplete":true}'::jsonb));
 BEGIN PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041','{"commandId":"efae0000-0000-4000-8000-000000000099","outcome":"succeeded","result":{"paymentComplete":false,"setupComplete":false}}'); RAISE EXCEPTION 'Late result accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Recovery not executing' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.payment_recovery WHERE id='efae0000-0000-4000-8000-000000000099')<>'failed' THEN RAISE EXCEPTION 'Stale read not failed'; END IF;
END $$;
-- Fresh reads and all mutation attempts remain fenced, even when old.
INSERT INTO oxygen_private.payment_recovery(id,workflow_id,booking_reference,expected_version,idempotency_key,action,status,created_at,started_at)
VALUES('efae0000-0000-4000-8000-000000000096','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071',3,'efae0000-0000-4000-8000-000000000095','check_status','executing',now()-interval '1 hour',clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000094","action":"check_status"}'); RAISE EXCEPTION 'Fresh check reclaimed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.payment_recovery SET status='failed' WHERE id='efae0000-0000-4000-8000-000000000096';
INSERT INTO oxygen_private.payment_recovery(id,workflow_id,booking_reference,expected_version,idempotency_key,action,status,created_at,started_at)
VALUES('efae0000-0000-4000-8000-000000000093','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000071',3,'efae0000-0000-4000-8000-000000000092','resend_upfront','executing',now()-interval '1 hour',now()-interval '1 hour');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000094","action":"check_status"}'); RAISE EXCEPTION 'Mutation reclaimed'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.payment_recovery WHERE id='efae0000-0000-4000-8000-000000000093')<>'executing' THEN RAISE EXCEPTION 'Mutation state changed'; END IF;
END $$;
ROLLBACK;
