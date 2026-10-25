-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efad0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efad0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efad0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efad0000-0000-4000-8000-000000000021','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000031','efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','efad0000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efad0000-0000-4000-8000-000000000011','efad0000-0000-4000-8000-000000000003','response-evidence-fixture',true);
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at)
VALUES('efad0000-0000-4000-8000-000000000081','efad0000-0000-4000-8000-000000000041','efad0000-0000-4000-8000-000000000091',0,'web','{"action":"approve_booking"}','executing',now());
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE evidence jsonb; encrypted text := 'v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',48); BEGIN
 PERFORM public.oxygen_response_evidence('record','efad0000-0000-4000-8000-000000000081',1,encrypted);
 PERFORM public.oxygen_response_evidence('record','efad0000-0000-4000-8000-000000000081',1,replace(encrypted,'c','d'));
 evidence:=public.oxygen_response_evidence('read','efad0000-0000-4000-8000-000000000081');
 IF jsonb_array_length(evidence)<>1 OR evidence->0->>'ciphertext'<>encrypted THEN RAISE EXCEPTION 'Evidence overwritten or missing'; END IF;
 IF (evidence->0->>'expiresAt')::timestamptz-(evidence->0->>'createdAt')::timestamptz<>interval '24 hours' THEN RAISE EXCEPTION 'Wrong retention'; END IF;
 BEGIN PERFORM public.oxygen_response_evidence('record','efad0000-0000-4000-8000-000000000081',2,'plaintext'); RAISE EXCEPTION 'Plaintext accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Evidence unavailable' THEN RAISE; END IF; END;
 BEGIN PERFORM 1 FROM oxygen_private.response_evidence; RAISE EXCEPTION 'Direct access permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_response_evidence('read','efad0000-0000-4000-8000-000000000081'); RAISE EXCEPTION 'Customer access permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_response_evidence('read','efad0000-0000-4000-8000-000000000081'); RAISE EXCEPTION 'Stranger access permitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE oxygen_private.response_evidence SET expires_at=now()-interval '1 second';
UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='efad0000-0000-4000-8000-000000000081';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efad0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF public.oxygen_response_evidence('read','efad0000-0000-4000-8000-000000000081')<>'[]'::jsonb THEN RAISE EXCEPTION 'Expired evidence exposed'; END IF;
 BEGIN PERFORM public.oxygen_response_evidence('record','efad0000-0000-4000-8000-000000000081',2,'v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',48)); RAISE EXCEPTION 'Nonexecuting write permitted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Evidence unavailable' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='efad0000-0000-4000-8000-000000000081' AND status<>'indeterminate') THEN RAISE EXCEPTION 'Evidence changed command'; END IF;
END $$;
ROLLBACK;
