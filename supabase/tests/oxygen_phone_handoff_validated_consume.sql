-- Rollback-only worker authorization, binding and single-use regression.
BEGIN;
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('efaf0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handoff-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaf0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handoff-worker@example.test','test',now(),now(),now(),'{}','{}'),
 ('efaf0000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','handoff-other@example.test','test',now(),now(),now(),'{}','{}');
-- Seed the merchant under its authenticated actor for audit and order context.
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000003','handoff-other@example.test','Handoff fixture','oxygen-handoff-validated-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('efaf0000-0000-4000-8000-000000000021','efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000001','Test','Owner','handoff-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('efaf0000-0000-4000-8000-000000000031','efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000021','OXYGEN-HANDOFF-VALIDATED',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('efaf0000-0000-4000-8000-000000000041','efaf0000-0000-4000-8000-000000000031','efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000021');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('handoff-validated-fixture','efaf0000-0000-4000-8000-000000000002');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('efaf0000-0000-4000-8000-000000000011','efaf0000-0000-4000-8000-000000000002','handoff-validated-fixture',true);
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('efaf0000-0000-4000-8000-000000000041','{"validated":true,"applicationReference":"efaf0000-0000-4000-8000-000000000051"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000001',true);
SELECT public.oxygen_phone_handoff('issue','efaf0000-0000-4000-8000-000000000041',repeat('a',64),jsonb_build_object('applicationReference','efaf0000-0000-4000-8000-000000000051','ciphertext','synthetic-encrypted-target','expiresAt',now()+interval '4 minutes'));
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_phone_handoff('peek',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Owner could peek'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Owner could consume'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.oxygen_phone_handoff(NULL,'efaf0000-0000-4000-8000-000000000041',repeat('a',64),'{}'); RAISE EXCEPTION 'Null operation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000002',true);
DO $$ DECLARE snapshot jsonb; BEGIN
 snapshot:=public.oxygen_phone_handoff('peek',NULL,repeat('a',64),'{}');
 IF snapshot->>'ciphertext'<>'synthetic-encrypted-target' THEN RAISE EXCEPTION 'Peek mismatch'; END IF;
 IF public.oxygen_phone_handoff('peek',NULL,repeat('a',64),'{}') IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'Peek consumed token'; END IF;
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),snapshot||'{"ciphertext":"changed"}'::jsonb); RAISE EXCEPTION 'Changed ciphertext consumed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),snapshot||'{"environment":"production"}'::jsonb); RAISE EXCEPTION 'Changed environment consumed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Unbound consume accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM set_config('TimeZone','UTC',true);
 IF public.oxygen_phone_handoff('consume',NULL,repeat('a',64),snapshot) IS DISTINCT FROM '{"consumed":true}'::jsonb THEN RAISE EXCEPTION 'Consume failed'; END IF;
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('a',64),snapshot); RAISE EXCEPTION 'Replay consumed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.oxygen_phone_handoff('peek',NULL,repeat('a',64),'{}'); RAISE EXCEPTION 'Consumed token peeked'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000001',true);
SELECT public.oxygen_phone_handoff('issue','efaf0000-0000-4000-8000-000000000041',repeat('b',64),jsonb_build_object('applicationReference','efaf0000-0000-4000-8000-000000000051','ciphertext','second-target','expiresAt',now()+interval '4 minutes'));
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000002',true);
SELECT set_config('test.peek_snapshot',public.oxygen_phone_handoff('peek',NULL,repeat('b',64),'{}')::text,true);
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000001',true);
SELECT public.oxygen_phone_handoff('issue','efaf0000-0000-4000-8000-000000000041',repeat('c',64),jsonb_build_object('applicationReference','efaf0000-0000-4000-8000-000000000051','ciphertext','replacement-target','expiresAt',now()+interval '4 minutes'));
SELECT set_config('request.jwt.claim.sub','efaf0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_phone_handoff('consume',NULL,repeat('b',64),current_setting('test.peek_snapshot')::jsonb); RAISE EXCEPTION 'Revoked peek consumed'; EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;
ROLLBACK;
