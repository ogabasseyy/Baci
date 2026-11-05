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
UPDATE public.oxygen_workflows SET stage='booked' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"BOOKED"}}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"refresh_kyc"}','executing',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_kyc"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'KYC retry not queued'; END IF;
 PERFORM set_config('test.kyc.id',r->>'commandId',true);
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 PERFORM public.oxygen_runtime('claim',current_setting('test.kyc.id')::uuid,jsonb_build_object('commandId',current_setting('test.kyc.id')));
 BEGIN PERFORM public.oxygen_runtime('finish','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081","outcome":"succeeded","stage":"approval_required","state":{"kyc":{"address_status":"DONE"}}}');
 RAISE EXCEPTION 'Late KYC result accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Command is not executing' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000081')<>'failed' THEN RAISE EXCEPTION 'Stale KYC not retired'; END IF;
 IF (SELECT state ? 'kyc' FROM oxygen_private.provider_states WHERE workflow_id='efae0000-0000-4000-8000-000000000041') THEN RAISE EXCEPTION 'Late KYC state applied'; END IF;
END $$;
-- Fresh KYC remains fenced; neither ordinary status reads nor retry reaps it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 PERFORM public.oxygen_runtime('status','efae0000-0000-4000-8000-000000000041');
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"refresh_kyc"}}'); RAISE EXCEPTION 'Fresh KYC reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"approve_booking"}',started_at=now()-interval '1 hour' WHERE id=current_setting('test.kyc.id')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"refresh_kyc"}}'); RAISE EXCEPTION 'Financial command reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id=current_setting('test.kyc.id')::uuid)<>'executing' THEN RAISE EXCEPTION 'Financial command state changed'; END IF;
END $$;
-- Callback-worker reconciliation uses the same bounded KYC reaper.
UPDATE oxygen_private.commands SET command='{"action":"refresh_kyc"}',started_at=now()-interval '5 minutes' WHERE id=current_setting('test.kyc.id')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('reconcile','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000085","command":{"action":"refresh_kyc"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Callback KYC reconcile blocked'; END IF;
END $$;
RESET ROLE;
-- An abandoned queued read can be resumed by its key or reclaimed by a new key.
UPDATE oxygen_private.commands SET created_at=now()-interval '5 minutes' WHERE idempotency_key='efae0000-0000-4000-8000-000000000085';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000085","command":{"action":"refresh_kyc"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Original queued key did not resume'; END IF;
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000086","command":{"action":"refresh_kyc"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Stale queued KYC not replaced'; END IF;
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000090","command":{"action":"refresh_kyc"}}'); RAISE EXCEPTION 'Fresh queued KYC reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE idempotency_key='efae0000-0000-4000-8000-000000000085')<>'failed' THEN RAISE EXCEPTION 'Stale queued KYC not retired'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='failed' WHERE idempotency_key='efae0000-0000-4000-8000-000000000086';
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000087','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000088',0,'web','{"action":"refresh_details"}','executing',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000089","command":{"action":"refresh_details"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Stale details read blocked retry'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000087')<>'failed' THEN RAISE EXCEPTION 'Stale details not retired'; END IF;
END $$;
ROLLBACK;
