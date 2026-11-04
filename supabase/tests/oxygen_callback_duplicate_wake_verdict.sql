-- Real inbox regression; the enclosing transaction rolls back every fixture.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES('ca110000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','callback-worker@example.test','test',now(),now(),now(),'{}','{}'),
('ca110000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','callback-other@example.test','test',now(),now(),now(),'{}','{}');
SELECT set_config('request.jwt.claim.sub','ca110000-0000-4000-8000-000000000001',true);
INSERT INTO public.merchants(id,user_id,email,business_name,slug)
VALUES('ca110000-0000-4000-8000-000000000002','ca110000-0000-4000-8000-000000000001','callback-worker@example.test','Callback fixture','oxygen-callback-legacy-fixture'),
('ca110000-0000-4000-8000-000000000003','ca110000-0000-4000-8000-000000000004','callback-other@example.test','Other fixture','oxygen-callback-other-fixture');
INSERT INTO oxygen_private.partner_workers(partner_reference,worker_user_id)
VALUES('callback-legacy-fixture','ca110000-0000-4000-8000-000000000001'),
('callback-other-fixture','ca110000-0000-4000-8000-000000000001');
INSERT INTO oxygen_private.runtime_bindings(merchant_id,worker_user_id,partner_reference,enabled,environment)
VALUES('ca110000-0000-4000-8000-000000000002','ca110000-0000-4000-8000-000000000001','callback-legacy-fixture',true,'staging'),
('ca110000-0000-4000-8000-000000000003','ca110000-0000-4000-8000-000000000001','callback-other-fixture',true,'staging');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ca110000-0000-4000-8000-000000000001',true);
DO $$ DECLARE e jsonb; r jsonb; BEGIN
 e:='{"kind":"transaction","deduplicationKey":"transaction:wake","transactionReference":"wake","bookedLoanReference":"loan","providerAmountSent":"1.00","providerAmountDeducted":"1.00"}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',e)->>'result'<>'accepted' THEN RAISE EXCEPTION 'Transaction not accepted'; END IF;
 r:=public.oxygen_callback('accept','callback-legacy-fixture',e);
 IF r->>'result'<>'duplicate' OR r->'wakeNeeded' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Queued duplicate must wake'; END IF;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(e,'{providerAmountSent}','"2.00"')); RAISE EXCEPTION 'Conflict accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- A deferred row remains a useful wake even if its backoff has not elapsed;
-- never assume an external scheduler is registered.
UPDATE oxygen_private.callback_inbox SET next_attempt_at=now()+interval '1 minute'
 WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='transaction:wake';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.oxygen_callback('accept','callback-legacy-fixture','{"kind":"transaction","deduplicationKey":"transaction:wake","transactionReference":"wake","bookedLoanReference":"loan","providerAmountSent":"1.00","providerAmountDeducted":"1.00"}');
 IF r->'wakeNeeded' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Deferred duplicate lost its wake'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.callback_inbox SET status='done' WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='transaction:wake';
SET LOCAL ROLE authenticated;
DO $$ DECLARE e jsonb; r jsonb; BEGIN
 e:='{"kind":"transaction","deduplicationKey":"transaction:wake","transactionReference":"wake","bookedLoanReference":"loan","providerAmountSent":"1.00","providerAmountDeducted":"1.00"}'::jsonb;
 IF public.oxygen_callback('accept','callback-other-fixture',e)->>'result'<>'accepted' THEN RAISE EXCEPTION 'Other partner was not isolated'; END IF;
 r:=public.oxygen_callback('accept','callback-legacy-fixture',e);
 IF r->>'result'<>'duplicate' OR r->'wakeNeeded' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Terminal duplicate must not wake because of another partner'; END IF;
 IF public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(jsonb_set(e,'{deduplicationKey}','"transaction:other"'),'{transactionReference}','"other"'))->>'result'<>'accepted' THEN RAISE EXCEPTION 'Other queued transaction not accepted'; END IF;
 r:=public.oxygen_callback('accept','callback-legacy-fixture',e);
 IF r->'wakeNeeded' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Terminal duplicate must wake another queued transaction'; END IF;
 e:='{"kind":"address","deduplicationKey":"address:wake","phoneNumber":"2348012345678","applicationReference":"ca110000-0000-4000-8000-000000000010","addressValidated":true,"action":"reconcile_kyc"}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',e)->>'result'<>'accepted' THEN RAISE EXCEPTION 'Address not accepted'; END IF;
END $$;
RESET ROLE;
UPDATE oxygen_private.callback_inbox SET status='done' WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='address:wake';
SELECT set_config('test.callback_wake_old_retry',(SELECT retry_key::text FROM oxygen_private.callback_inbox WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='address:wake'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE e jsonb; r jsonb; BEGIN
 e:='{"kind":"address","deduplicationKey":"address:wake","phoneNumber":"2348012345678","applicationReference":"ca110000-0000-4000-8000-000000000010","addressValidated":true,"action":"reconcile_kyc"}'::jsonb;
 r:=public.oxygen_callback('accept','callback-legacy-fixture',e);
 IF r->>'result'<>'duplicate' OR r->'wakeNeeded' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Redelivered address must wake'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.callback_inbox WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='address:wake' AND status='queued' AND retry_key::text<>current_setting('test.callback_wake_old_retry')) THEN RAISE EXCEPTION 'Redelivery generation did not rotate'; END IF;
END $$;
ROLLBACK;
