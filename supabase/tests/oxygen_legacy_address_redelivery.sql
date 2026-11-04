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

DO $$ BEGIN
 FOR n IN 2..7 LOOP
 INSERT INTO public.orders(id,merchant_id,customer_id,order_number,total,currency,payment_status,payment_method)
 VALUES (('efae0000-0000-4000-8000-00000000003'||n)::uuid,'efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021','CALLBACK-REF-'||n,400000,'NGN','unpaid','oxygen');
 INSERT INTO public.oxygen_workflows(id,order_id,merchant_id,customer_id)
 VALUES (('efae0000-0000-4000-8000-00000000004'||n)::uuid,('efae0000-0000-4000-8000-00000000003'||n)::uuid,'efae0000-0000-4000-8000-000000000011','efae0000-0000-4000-8000-000000000021');
 END LOOP;
END $$;
INSERT INTO oxygen_private.provider_states(workflow_id,state)
SELECT ('efae0000-0000-4000-8000-00000000004'||n)::uuid,
 jsonb_build_object('phone','2348010000000','applicationReference','application-'||n)
FROM generate_series(1,7) n;

-- Simulate a callback exhausted under the earlier five-attempt policy.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','efae0000-0000-4000-8000-000000000003',true);
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-exhausted","action":"reconcile_kyc"}');
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-ambiguous","action":"reconcile_kyc"}');
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","addressValidated":true,"deduplicationKey":"legacy-missing","action":"reconcile_kyc"}');
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-four","action":"reconcile_kyc"}');
RESET ROLE;
UPDATE oxygen_private.callback_inbox SET status='observed',attempts=5 WHERE deduplication_key='legacy-exhausted';
UPDATE oxygen_private.callback_inbox SET status='observed',attempts=5,resolution_error='ambiguous_address' WHERE deduplication_key='legacy-ambiguous';
UPDATE oxygen_private.callback_inbox SET status='observed',attempts=5,resolution_error='missing_application_reference' WHERE deduplication_key='legacy-missing';
UPDATE oxygen_private.callback_inbox SET status='observed',attempts=4 WHERE deduplication_key='legacy-four';
-- Same event key in a different environment must not be re-driven.
INSERT INTO oxygen_private.callback_inbox(partner_reference,environment,deduplication_key,payload_hash,event,status,attempts)
 SELECT partner_reference,'production',deduplication_key,payload_hash,event,'observed',5
 FROM oxygen_private.callback_inbox WHERE deduplication_key='legacy-exhausted' AND environment='staging';
SELECT set_config('test.old_retry',(SELECT retry_key::text FROM oxygen_private.callback_inbox WHERE deduplication_key='legacy-exhausted' AND environment='staging'),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE jobs jsonb; item jsonb; BEGIN
 IF public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-exhausted","action":"reconcile_kyc"}')->>'result'<>'duplicate' THEN RAISE EXCEPTION 'Redelivery acknowledgement changed'; END IF;
 PERFORM public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-ambiguous","action":"reconcile_kyc"}');
 PERFORM public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","addressValidated":true,"deduplicationKey":"legacy-missing","action":"reconcile_kyc"}');
 PERFORM public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-four","action":"reconcile_kyc"}');
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 THEN RAISE EXCEPTION 'Expected exactly the safe legacy address event'; END IF;
 item:=jobs->0;
 IF item->>'retryKey'=current_setting('test.old_retry') THEN RAISE EXCEPTION 'Retry generation was not rotated'; END IF;
 PERFORM public.oxygen_callback('complete','response-evidence-fixture',jsonb_build_object('id',item->>'id','retryKey',current_setting('test.old_retry')));
 PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',item->>'id','retryKey',current_setting('test.old_retry')));
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->>'retryKey'<>item->>'retryKey' THEN RAISE EXCEPTION 'Stale worker retired redelivery'; END IF;
 -- Current failed reads remain queued, are deferred with a fresh generation,
 -- and a same-value redelivery wakes them without creating a second row.
 PERFORM public.oxygen_callback('defer','response-evidence-fixture',jsonb_build_object('id',item->>'id','retryKey',item->>'retryKey'));
 PERFORM public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-exhausted","action":"reconcile_kyc"}');
 jobs:=public.oxygen_callback('pending','response-evidence-fixture','{}');
 IF jsonb_array_length(jobs)<>1 OR jobs->0->>'id'<>item->>'id' OR jobs->0->>'retryKey'=item->>'retryKey' THEN RAISE EXCEPTION 'Failed read redelivery was lost'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.callback_inbox WHERE deduplication_key='legacy-exhausted' AND environment='staging' AND status='queued' AND attempts=0) THEN RAISE EXCEPTION 'Legacy failed event not requeued'; END IF;
 IF NOT EXISTS(SELECT 1 FROM oxygen_private.callback_inbox WHERE deduplication_key='legacy-exhausted' AND environment='production' AND status='observed' AND attempts=5) THEN RAISE EXCEPTION 'Foreign environment changed'; END IF;
 IF (SELECT count(*) FROM oxygen_private.callback_inbox WHERE deduplication_key IN ('legacy-ambiguous','legacy-missing','legacy-four') AND status='observed')<>3 THEN RAISE EXCEPTION 'Quarantined callback resumed'; END IF;
END $$;
-- A historically exhausted exact-reference row is still quarantined when
-- the candidate cannot be uniquely attributed at the time of redelivery.
-- The current schema prevents duplicates; temporarily remove the index inside
-- this rolled-back transaction to exercise the defensive legacy-data branch.
DROP INDEX oxygen_private.oxygen_state_application_idx;
UPDATE oxygen_private.provider_states SET state=jsonb_set(state,'{applicationReference}','"application-4"') WHERE workflow_id='efae0000-0000-4000-8000-000000000047';
SET LOCAL ROLE authenticated;
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-nonunique","action":"reconcile_kyc"}');
RESET ROLE;
UPDATE oxygen_private.callback_inbox SET status='observed',attempts=5 WHERE deduplication_key='legacy-nonunique';
SET LOCAL ROLE authenticated;
SELECT public.oxygen_callback('accept','response-evidence-fixture','{"kind":"address","phoneNumber":"08010000000","applicationReference":"application-4","addressValidated":true,"deduplicationKey":"legacy-nonunique","action":"reconcile_kyc"}');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM oxygen_private.callback_inbox WHERE deduplication_key='legacy-nonunique' AND status='observed') THEN RAISE EXCEPTION 'Non-unique candidate resumed'; END IF;
END $$;
ROLLBACK;
