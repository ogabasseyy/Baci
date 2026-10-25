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
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; p jsonb := '{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000091","action":"check_status"}'; BEGIN
 r:=public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');
 IF r->>'reference'<>'efae0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Wrong reference'; END IF;
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p);
 PERFORM set_config('test.recovery.command',r->>'commandId',true);
 IF public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p)<>r THEN RAISE EXCEPTION 'Idempotency did not reuse command'; END IF;
 BEGIN PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',r->>'commandId'));RAISE EXCEPTION 'Customer claimed worker operation';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');RAISE EXCEPTION 'Cross customer read';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command')));RAISE EXCEPTION 'Wrong worker';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command')));
 IF r->>'action'<>'check_status' OR r->>'reference'<>'efae0000-0000-4000-8000-000000000071' THEN RAISE EXCEPTION 'Wrong claimed binding'; END IF;
 IF public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command'))) IS NOT NULL THEN RAISE EXCEPTION 'Claim replayed'; END IF;
 PERFORM public.oxygen_payment_recovery('evidence','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command'),'sequence',1,'ciphertext','v1.'||repeat('a',16)||'.'||repeat('b',22)||'.'||repeat('c',48)));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command'),'outcome','succeeded','result','{"paymentComplete":false,"setupComplete":true}'::jsonb));
 r:=public.oxygen_payment_recovery('evidence_read','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command')));
 IF jsonb_array_length(r)<>1 THEN RAISE EXCEPTION 'Evidence lost after completion'; END IF;
 BEGIN PERFORM 1 FROM oxygen_private.payment_recovery;RAISE EXCEPTION 'Direct read permitted';EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE p jsonb := '{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000092","action":"resend_upfront"}'; r jsonb; BEGIN
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p||'{"version":4}');RAISE EXCEPTION 'Stale version accepted';EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p||'{"reference":"efae0000-0000-4000-8000-000000000072"}');RAISE EXCEPTION 'Wrong reference accepted';EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p||'{"action":"resend_repayment"}');RAISE EXCEPTION 'Complete setup resent';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Fresh incomplete payment status required' THEN RAISE; END IF; END;
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041',p);PERFORM set_config('test.recovery.command',r->>'commandId',true);
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command')));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command'),'outcome','succeeded','result','{"paymentUrl":"https://payment.hydrogenpay.com/?transactionId=synthetic"}'::jsonb));
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');IF r->>'paymentUrl' IS NULL OR (r->>'paymentComplete')::boolean<>false THEN RAISE EXCEPTION 'Link not restored'; END IF;
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000093","action":"resend_upfront"}');PERFORM set_config('test.recovery.command',r->>'commandId',true);
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 PERFORM public.oxygen_payment_recovery('claim','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command')));
 PERFORM public.oxygen_payment_recovery('finish','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',current_setting('test.recovery.command'),'outcome','indeterminate','result','{}'::jsonb));
END $$;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000001',true);
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041');IF r->>'resendBlocked'<>'true' OR r->>'paymentUrl' IS NOT NULL THEN RAISE EXCEPTION 'Uncertain resend exposed stale link'; END IF;
 BEGIN PERFORM public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000094","action":"resend_upfront"}');RAISE EXCEPTION 'Uncertain resend repeated';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Recovery confirmation required' THEN RAISE; END IF; END;
END $$;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_payment_recovery('enqueue','efae0000-0000-4000-8000-000000000041','{"workflowId":"efae0000-0000-4000-8000-000000000041","reference":"efae0000-0000-4000-8000-000000000071","version":3,"idempotencyKey":"efae0000-0000-4000-8000-000000000095","action":"check_status"}');
 PERFORM public.oxygen_payment_recovery('abandon','efae0000-0000-4000-8000-000000000041',jsonb_build_object('commandId',r->>'commandId'));
 IF public.oxygen_payment_recovery('status','efae0000-0000-4000-8000-000000000041')->>'pending'<>'false' THEN RAISE EXCEPTION 'Abandoned queued intent blocked recovery'; END IF;
 IF has_function_privilege('anon','public.oxygen_payment_recovery(text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous recovery execution granted'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT stage FROM public.oxygen_workflows WHERE id='efae0000-0000-4000-8000-000000000041')<>'reconciliation_required' OR
 (SELECT status FROM oxygen_private.commands WHERE id='efae0000-0000-4000-8000-000000000081')<>'indeterminate' OR
 (SELECT state FROM oxygen_private.provider_states WHERE workflow_id='efae0000-0000-4000-8000-000000000041')<>'{"bookingReference":"efae0000-0000-4000-8000-000000000071","booking":{"status":"BOOKED"}}'::jsonb THEN RAISE EXCEPTION 'Original approval history overwritten'; END IF;
END $$;
ROLLBACK;
