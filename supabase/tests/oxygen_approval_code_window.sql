-- Transactional RLS regression. Run on a disposable database after migrations.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efac0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('efac0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efac0000-0000-4000-8000-000000000021','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status)
VALUES ('efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000031','efac0000-0000-4000-8000-000000000011','efac0000-0000-4000-8000-000000000021');

INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efac0000-0000-4000-8000-000000000041','{"bookingReference":"efac0000-0000-4000-8000-000000000071","activityToken":"synthetic-fixture-only"}');
INSERT INTO oxygen_private.commands(id,workflow_id,idempotency_key,expected_version,channel,command,status,started_at,completed_at)
VALUES ('efac0000-0000-4000-8000-000000000081','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000091',0,'web','{"action":"trigger_approval_otp"}','succeeded',now()-interval '2 minutes',now()-interval '119 seconds'),
('efac0000-0000-4000-8000-000000000082','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000092',0,'web','{"action":"trigger_approval_otp"}','succeeded',now()-interval '1 minute',now()-interval '59 seconds');
INSERT INTO oxygen_private.provider_reference_history(command_id,workflow_id,booking_reference) VALUES
('efac0000-0000-4000-8000-000000000081','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000071'),
('efac0000-0000-4000-8000-000000000082','efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000072');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE result jsonb; BEGIN
 result:=public.oxygen_approval_code_window('efac0000-0000-4000-8000-000000000041');
 IF result->>'bookingReference'<>'efac0000-0000-4000-8000-000000000071' OR (result->>'sentAt')::timestamptz<>now()-interval '2 minutes' THEN RAISE EXCEPTION 'Wrong reference or send time'; END IF;
 IF (result->>'expiresAt')::timestamptz-(result->>'sentAt')::timestamptz<>interval '5 minutes' THEN RAISE EXCEPTION 'Wrong expiry'; END IF;
 IF result::text LIKE '%synthetic-fixture-only%' THEN RAISE EXCEPTION 'Token leaked'; END IF;
 IF public.oxygen_approval_code_window('efac0000-0000-4000-8000-000000000041')<>result THEN RAISE EXCEPTION 'Reopening changed expiry'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_approval_code_window('efac0000-0000-4000-8000-000000000041'); RAISE EXCEPTION 'Cross-customer timing exposed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
INSERT INTO oxygen_private.commands(workflow_id,idempotency_key,expected_version,channel,command,status)
VALUES('efac0000-0000-4000-8000-000000000041','efac0000-0000-4000-8000-000000000093',0,'web','{"action":"trigger_approval_otp"}','indeterminate');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efac0000-0000-4000-8000-000000000001',true);
DO $$ BEGIN IF public.oxygen_approval_code_window('efac0000-0000-4000-8000-000000000041') IS NOT NULL THEN RAISE EXCEPTION 'Uncertain resend reused old timing'; END IF; END $$;
ROLLBACK;
