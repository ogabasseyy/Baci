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
UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"applicationReference":"efae0000-0000-4000-8000-000000000071"}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,created_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000082',0,'web','{"action":"refresh_eligibility"}','queued',now()-interval '5 minutes');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_eligibility"}}'); RAISE EXCEPTION 'Foreign customer accessed workflow'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000082","command":{"action":"refresh_eligibility"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Same-key resume failed'; END IF;
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_eligibility"}}');
 IF r->>'status'<>'queued' THEN RAISE EXCEPTION 'Stale queued eligibility not replaced'; END IF;
 PERFORM set_config('test.fresh.id',r->>'commandId',true);
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"refresh_eligibility"}}'); RAISE EXCEPTION 'Fresh queued eligibility reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('claim','efae0000-0000-4000-8000-000000000081','{"commandId":"efae0000-0000-4000-8000-000000000081"}');
 IF r IS NOT NULL THEN RAISE EXCEPTION 'Reclaimed queued command claimed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000081')<>'failed' THEN RAISE EXCEPTION 'Old queued eligibility not retired'; END IF;
END $$;
UPDATE oxygen_private.commands SET status='executing',started_at=now()-interval '1 hour' WHERE id=current_setting('test.fresh.id')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"refresh_eligibility"}}'); RAISE EXCEPTION 'Uncertain executing eligibility reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
-- If the queued row was claimed while the user clicked, the same key
-- returns the executing command and the second claim cannot dispatch it.
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000083","command":{"action":"refresh_eligibility"}}');
 IF r->>'status'<>'executing' THEN RAISE EXCEPTION 'Executing same-key status missing'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_runtime('claim',current_setting('test.fresh.id')::uuid,jsonb_build_object('commandId',current_setting('test.fresh.id')));
 IF r IS NOT NULL THEN RAISE EXCEPTION 'Executing eligibility claimed again'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
RESET ROLE;
UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE id=current_setting('test.fresh.id')::uuid;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_runtime('enqueue','efae0000-0000-4000-8000-000000000041','{"version":0,"idempotencyKey":"efae0000-0000-4000-8000-000000000084","command":{"action":"refresh_eligibility"}}'); RAISE EXCEPTION 'Financial mutation reaped'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
