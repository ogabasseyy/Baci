-- Scoped function regression, run against the standalone fixture or full replay.
BEGIN;
-- Minimal provenance and interrupted command; UUIDs intentionally local only.
INSERT INTO auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
 ('e1110000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-owner@example.test','test',now(),now(),now(),'{}','{}'),
 ('e1110000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-stranger@example.test','test',now(),now(),now(),'{}','{}'),
 ('e1110000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','saved-plan-merchant@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','e1110000-0000-4000-8000-000000000003',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES ('e1110000-0000-4000-8000-000000000011','e1110000-0000-4000-8000-000000000003','saved-plan-merchant@example.test','Booking block fixture','oxygen-saved-plan-rls-fixture');
INSERT INTO public.customers(id,merchant_id,user_id,first_name,last_name,email)
VALUES ('e1110000-0000-4000-8000-000000000021','e1110000-0000-4000-8000-000000000011','e1110000-0000-4000-8000-000000000001','Test','Customer','saved-plan-owner@example.test');
INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
VALUES ('e1110000-0000-4000-8000-000000000031','e1110000-0000-4000-8000-000000000011','e1110000-0000-4000-8000-000000000021','OXYGEN-ELIGIBILITY-RLS',400000,'NGN','unpaid','oxygen');
INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
VALUES ('e1110000-0000-4000-8000-000000000041','e1110000-0000-4000-8000-000000000031','e1110000-0000-4000-8000-000000000011','e1110000-0000-4000-8000-000000000021');


INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id) VALUES('response-evidence-fixture','e1110000-0000-4000-8000-000000000003');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled) VALUES('e1110000-0000-4000-8000-000000000011','e1110000-0000-4000-8000-000000000003','response-evidence-fixture',true);
UPDATE public.oxygen_workflows SET stage='eligibility_required' WHERE id='e1110000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.provider_states(workflow_id,state) VALUES('e1110000-0000-4000-8000-000000000041','{"applicationReference":"e1110000-0000-4000-8000-000000000071"}');
UPDATE public.oxygen_workflows SET version=3 WHERE id='e1110000-0000-4000-8000-000000000041';
INSERT INTO oxygen_private.commands(id,workflow_id,command,status,expected_version,started_at,idempotency_key,channel)
VALUES('e1110000-0000-4000-8000-000000000004','e1110000-0000-4000-8000-000000000041','{"action":"refresh_kyc"}','succeeded',2,now(),'e1110000-0000-4000-8000-000000000094','web'),
 ('e1110000-0000-4000-8000-000000000005','e1110000-0000-4000-8000-000000000041','{"action":"refresh_eligibility"}','executing',3,now()-interval '5 minutes','e1110000-0000-4000-8000-000000000095','web');
INSERT INTO oxygen_private.history(workflow_id,command_id,stage,version) VALUES('e1110000-0000-4000-8000-000000000041','e1110000-0000-4000-8000-000000000004','eligibility_required',3);
INSERT INTO oxygen_private.provider_reference_history(command_id,workflow_id,application_reference) VALUES('e1110000-0000-4000-8000-000000000004','e1110000-0000-4000-8000-000000000041','e1110000-0000-4000-8000-000000000071');
DO $$ DECLARE original jsonb; mode text; BEGIN
 SELECT state INTO original FROM oxygen_private.provider_states WHERE workflow_id='e1110000-0000-4000-8000-000000000041';
 FOREACH mode IN ARRAY ARRAY['fresh','old_version','different_application','missing_history','booking','eligible','mutation','uncertain'] LOOP
  UPDATE oxygen_private.commands SET status='executing',expected_version=3,started_at=now()-interval '5 minutes',command='{"action":"refresh_eligibility"}' WHERE id='e1110000-0000-4000-8000-000000000005';
  UPDATE oxygen_private.provider_states SET state=original WHERE workflow_id='e1110000-0000-4000-8000-000000000041';
  IF mode='fresh' THEN UPDATE oxygen_private.commands SET started_at=now() WHERE workflow_id='e1110000-0000-4000-8000-000000000041' AND status='executing'; END IF;
  IF mode='old_version' THEN UPDATE oxygen_private.commands SET expected_version=2 WHERE workflow_id='e1110000-0000-4000-8000-000000000041' AND status='executing'; END IF;
  IF mode='different_application' THEN UPDATE oxygen_private.provider_states SET state='{"applicationReference":"e1110000-0000-4000-8000-000000000099"}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='missing_history' THEN UPDATE oxygen_private.history SET version=4 WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; ELSE UPDATE oxygen_private.history SET version=3 WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='booking' THEN UPDATE oxygen_private.provider_states SET state=state||'{"bookingReference":"e1110000-0000-4000-8000-000000000099"}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='eligible' THEN UPDATE oxygen_private.provider_states SET state=state||'{"eligible":true}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='mutation' THEN UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041' AND status='executing'; END IF;
  IF mode='uncertain' THEN UPDATE oxygen_private.commands SET status='indeterminate' WHERE workflow_id='e1110000-0000-4000-8000-000000000041' AND status='executing'; END IF;
  PERFORM oxygen_private.retire_stale_executing_eligibility('e1110000-0000-4000-8000-000000000041');
  IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='e1110000-0000-4000-8000-000000000005' AND status='failed') THEN RAISE EXCEPTION 'Unsafe reclamation: %',mode; END IF;
 END LOOP;
 UPDATE oxygen_private.commands SET status='executing' WHERE id='e1110000-0000-4000-8000-000000000005';
 UPDATE oxygen_private.provider_states SET state=original WHERE workflow_id='e1110000-0000-4000-8000-000000000041';
 PERFORM oxygen_private.retire_stale_executing_eligibility('e1110000-0000-4000-8000-000000000041');
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='e1110000-0000-4000-8000-000000000005' AND status='failed') THEN RAISE EXCEPTION 'Interrupted eligibility retrieval was not released'; END IF;
 BEGIN
  PERFORM oxygen_private.record_command('e1110000-0000-4000-8000-000000000005','succeeded','eligibility_required');
  RAISE EXCEPTION 'Late completion accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Command is not executing' THEN RAISE; END IF;
 END;
 IF (SELECT version FROM public.oxygen_workflows WHERE id='e1110000-0000-4000-8000-000000000041')<>3 THEN RAISE EXCEPTION 'Late completion advanced generation'; END IF;
END $$;
-- Existing bookings may recover the same read, never a financial mutation.
UPDATE public.oxygen_workflows SET stage='booked' WHERE id='e1110000-0000-4000-8000-000000000041';
UPDATE oxygen_private.provider_states SET state=state||'{"bookingReference":"e1110000-0000-4000-8000-000000000099","booking":{"loan_reference":"e1110000-0000-4000-8000-000000000099","status":"BOOKED"}}'::jsonb WHERE workflow_id='e1110000-0000-4000-8000-000000000041';
UPDATE oxygen_private.provider_reference_history SET booking_reference='e1110000-0000-4000-8000-000000000099' WHERE command_id='e1110000-0000-4000-8000-000000000004';
UPDATE oxygen_private.commands SET status='executing',completed_at=NULL,command='{"action":"refresh_eligibility"}',started_at=now()-interval '5 minutes' WHERE id='e1110000-0000-4000-8000-000000000005';
DO $$ BEGIN
 PERFORM oxygen_private.retire_stale_executing_eligibility('e1110000-0000-4000-8000-000000000041');
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='e1110000-0000-4000-8000-000000000005' AND status='failed') THEN RAISE EXCEPTION 'Interrupted booked offer read not released'; END IF;
 BEGIN
  PERFORM oxygen_private.record_command('e1110000-0000-4000-8000-000000000005','succeeded','booked');
  RAISE EXCEPTION 'Late booked read accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Command is not executing' THEN RAISE; END IF;
 END;
END $$;
DO $$ DECLARE mode text; BEGIN
 FOREACH mode IN ARRAY ARRAY['fresh','mutation','uncertain','paid','setup','wrong_booking','wrong_application'] LOOP
  UPDATE oxygen_private.commands SET status='executing',expected_version=3,completed_at=NULL,started_at=now()-interval '5 minutes',command='{"action":"refresh_eligibility"}' WHERE id='e1110000-0000-4000-8000-000000000005';
  UPDATE oxygen_private.provider_states SET state='{"applicationReference":"e1110000-0000-4000-8000-000000000071","bookingReference":"e1110000-0000-4000-8000-000000000099","booking":{"loan_reference":"e1110000-0000-4000-8000-000000000099","status":"BOOKED"}}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041';
  IF mode='fresh' THEN UPDATE oxygen_private.commands SET started_at=now() WHERE id='e1110000-0000-4000-8000-000000000005'; END IF;
  IF mode='mutation' THEN UPDATE oxygen_private.commands SET command='{"action":"book"}' WHERE id='e1110000-0000-4000-8000-000000000005'; END IF;
  IF mode='uncertain' THEN UPDATE oxygen_private.commands SET status='indeterminate' WHERE id='e1110000-0000-4000-8000-000000000005'; END IF;
  IF mode='paid' THEN UPDATE oxygen_private.provider_states SET state=state||'{"paymentComplete":true}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='setup' THEN UPDATE oxygen_private.provider_states SET state=state||'{"setupComplete":true}' WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='wrong_booking' THEN UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{booking,loan_reference}','"e1110000-0000-4000-8000-000000000098"') WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  IF mode='wrong_application' THEN UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{applicationReference}','"e1110000-0000-4000-8000-000000000098"') WHERE workflow_id='e1110000-0000-4000-8000-000000000041'; END IF;
  PERFORM oxygen_private.retire_stale_executing_eligibility('e1110000-0000-4000-8000-000000000041');
  IF EXISTS(SELECT 1 FROM oxygen_private.commands WHERE id='e1110000-0000-4000-8000-000000000005' AND status='failed') THEN RAISE EXCEPTION 'Unsafe booked recovery: %',mode; END IF;
 END LOOP;
END $$;
ROLLBACK;
