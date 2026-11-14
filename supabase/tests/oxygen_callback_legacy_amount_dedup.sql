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
DO $$ DECLARE old jsonb; new jsonb; BEGIN
 old:='{"kind":"transaction","deduplicationKey":"transaction:legacy-1","transactionReference":"legacy-1","bookedLoanReference":"loan","amountSentMinor":12345,"amountDeductedMinor":12345}'::jsonb;
 new:='{"kind":"transaction","deduplicationKey":"transaction:legacy-1","transactionReference":"legacy-1","bookedLoanReference":"loan","providerAmountSent":"123.45","providerAmountDeducted":"123.45"}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Legacy transaction retry failed'; END IF;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(new,'{providerAmountSent}','"124.45"')); RAISE EXCEPTION 'Changed amount accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(new,'{bookedLoanReference}','"other"')); RAISE EXCEPTION 'Changed reference accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- An identical key at another partner must be accepted independently.
 IF public.oxygen_callback('accept','callback-other-fixture',new)->>'result'<>'accepted' THEN RAISE EXCEPTION 'Cross-partner key was merged'; END IF;
 -- The historic parser accepted leading zeros and up to its exact safe bound.
 old:='{"kind":"transaction","deduplicationKey":"transaction:boundary","amountSentMinor":9007199254740991,"amountDeductedMinor":100}'::jsonb;
 new:='{"kind":"transaction","deduplicationKey":"transaction:boundary","providerAmountSent":"90071992547409.91","providerAmountDeducted":"0001.00"}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Numeric boundary retry failed'; END IF;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(new,'{providerAmountSent}','"90071992547409.92"')); RAISE EXCEPTION 'Unsafe boundary accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 old:='{"kind":"transaction","deduplicationKey":"transaction:zero","amountSentMinor":0,"amountDeductedMinor":0}'::jsonb;
 new:='{"kind":"transaction","deduplicationKey":"transaction:zero","providerAmountSent":"0.00","providerAmountDeducted":"000"}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Zero boundary retry failed'; END IF;
 old:='{"kind":"transaction","deduplicationKey":"transaction:legacy-1","transactionReference":"legacy-1","bookedLoanReference":"loan","amountSentMinor":12345,"amountDeductedMinor":12345}'::jsonb;
 new:='{"kind":"transaction","deduplicationKey":"transaction:legacy-1","transactionReference":"legacy-1","bookedLoanReference":"loan","providerAmountSent":"123.45","providerAmountDeducted":"123.45"}'::jsonb;
 old:=jsonb_set(old,'{deduplicationKey}','"transaction:legacy-2"'); new:=jsonb_set(new,'{deduplicationKey}','"transaction:legacy-2"');
 IF public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Mixed-deployment transaction retry failed'; END IF;
 old:='{"kind":"settlement","partnerReference":"callback-legacy-fixture","deduplicationKey":"settlement:legacy-1","amountMinor":40000000,"activationAudit":{"scope":"partner","loans":[{"principalMinor":7500000,"equityMinor":2500000,"bookedLoanReference":"loan"}]}}'::jsonb;
 new:='{"kind":"settlement","partnerReference":"callback-legacy-fixture","deduplicationKey":"settlement:legacy-1","providerAmount":400000,"activationAudit":{"scope":"partner","loans":[{"providerLoanAmount":75000,"providerFirstRepayment":25000,"bookedLoanReference":"loan"}]}}'::jsonb;
 IF public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Legacy settlement retry failed'; END IF;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(new,'{activationAudit,loans,0,providerFirstRepayment}','25001')); RAISE EXCEPTION 'Changed loan accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.oxygen_callback('accept','callback-legacy-fixture',jsonb_set(new,'{activationAudit,scope}','"other"')); RAISE EXCEPTION 'Changed audit accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 old:=jsonb_set(old,'{deduplicationKey}','"settlement:legacy-2"'); new:=jsonb_set(new,'{deduplicationKey}','"settlement:legacy-2"');
 IF public.oxygen_callback('accept','callback-legacy-fixture',new)->>'result'<>'accepted' OR
    public.oxygen_callback('accept','callback-legacy-fixture',old)->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Mixed-deployment settlement retry failed'; END IF;
END $$;
-- Environment is derived from the worker binding; the same key in a different
-- environment is a new delivery and must not match staging's legacy row.
RESET ROLE;
UPDATE oxygen_private.runtime_bindings SET environment='production' WHERE merchant_id='ca110000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.oxygen_callback('accept','callback-legacy-fixture','{"kind":"transaction","deduplicationKey":"transaction:legacy-1","transactionReference":"legacy-1","bookedLoanReference":"loan","providerAmountSent":"123.45","providerAmountDeducted":"123.45"}') ->>'result'<>'accepted' THEN RAISE EXCEPTION 'Cross-environment key was merged'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT event FROM oxygen_private.callback_inbox WHERE partner_reference='callback-legacy-fixture' AND deduplication_key='transaction:legacy-2')->>'providerAmountSent' IS DISTINCT FROM '123.45' THEN RAISE EXCEPTION 'New callback evidence was rewritten'; END IF;
 IF (SELECT count(*) FROM oxygen_private.callback_inbox WHERE partner_reference='callback-legacy-fixture')<>7 THEN RAISE EXCEPTION 'Unexpected inbox rows'; END IF;
END $$;
ROLLBACK;
