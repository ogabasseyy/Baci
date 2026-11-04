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
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efae0000-0000-4000-8000-000000000081','efae0000-0000-4000-8000-000000000041','efae0000-0000-4000-8000-000000000091',0,'web','{"action":"approve_booking"}','indeterminate',now());

UPDATE public.oxygen_workflows SET stage='reconciliation_required',version=3 WHERE id='efae0000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efae0000-0000-4000-8000-000000000041','{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"BOOKED"}}');

INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status,received_at)
SELECT 'response-evidence-fixture','staging','aggregate-'||n,decode(repeat('00',32),'hex'),'{}'::jsonb,'queued',now()-interval '5 minutes'
FROM generate_series(1,1001) n;
INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status,received_at)
VALUES ('response-evidence-fixture','production','foreign-env',decode(repeat('00',32),'hex'),'{}'::jsonb,'queued',now()-interval '1 day'),
 ('response-evidence-fixture','staging','not-queued',decode(repeat('00',32),'hex'),'{}'::jsonb,'observed',now()-interval '1 day');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback('backlog','response-evidence-fixture','{}');
 IF r-ARRAY['pendingCount','capped','oldestAgeSeconds']<>'{}'::jsonb OR (r->>'pendingCount')::integer<>1000 OR r->>'capped'<>'true' OR (r->>'oldestAgeSeconds')::integer NOT BETWEEN 300 AND 360 THEN RAISE EXCEPTION 'Invalid bounded backlog: %',r; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_callback('backlog','response-evidence-fixture','{}'); RAISE EXCEPTION 'Non-worker read backlog'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND environment='staging' AND status='queued' AND deduplication_key<>'aggregate-1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback('backlog','response-evidence-fixture','{}');
 IF (r->>'pendingCount')::integer<>1 OR r->>'capped'<>'false' OR (r->>'oldestAgeSeconds')::integer NOT BETWEEN 300 AND 360 THEN RAISE EXCEPTION 'Invalid single-item backlog: %',r; END IF;
END $$;
RESET ROLE;
DELETE FROM oxygen_private.callback_inbox WHERE partner_reference='response-evidence-fixture' AND environment='staging' AND status='queued';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback('backlog','response-evidence-fixture','{}');
 IF (r->>'pendingCount')::integer<>0 OR r->>'capped'<>'false' OR r->'oldestAgeSeconds'<>'null'::jsonb THEN RAISE EXCEPTION 'Invalid empty backlog: %',r; END IF;
END $$;
ROLLBACK;
